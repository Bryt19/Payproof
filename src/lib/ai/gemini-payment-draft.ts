import { GoogleGenAI } from "@google/genai";

/**
 * Gemini tool-calling client for payment-request draft preparation.
 *
 * The model may only propose a draft through the `prepare_payment_request`
 * tool. The tool schema has no wallet, reference, status or persistence
 * fields, and this module never executes a tool itself: the server validates
 * the returned arguments and decides whether a draft can be prepared.
 */

export const DRAFT_GEMINI_MODEL = "gemini-3.1-flash-lite";
export const PREPARE_PAYMENT_REQUEST_TOOL = "prepare_payment_request";

const REQUEST_TIMEOUT_MS = 25_000;

export type DraftConversationTurn = {
  role: "user" | "assistant";
  text: string;
};

export type GeminiDraftProposal =
  | { kind: "tool_call"; arguments: Record<string, unknown> }
  | { kind: "message"; text: string };

export type GeminiDraftResult =
  | { ok: true; proposal: GeminiDraftProposal }
  | {
      ok: false;
      code:
        | "missing_api_key"
        | "invalid_api_key"
        | "quota_exceeded"
        | "model_unavailable"
        | "upstream_timeout"
        | "invalid_model_response"
        | "upstream_error";
      message: string;
    };

const SYSTEM_INSTRUCTION = [
  "You are PayProof AI, preparing a payment request for an authenticated merchant.",
  "",
  `Call the ${PREPARE_PAYMENT_REQUEST_TOOL} tool when the merchant asks to create a payment request AND has provided both an amount and a description.`,
  "The amount argument must be a decimal string in SOL, for example \"0.5\". Never include a currency code or symbol in the amount.",
  "PayProof payment requests currently support SOL only. If the merchant gives an amount in GHS, USD or any other currency, do not call the tool and do not convert it: reply that PayProof supports SOL only and ask for the equivalent SOL amount.",
  "If the amount or description is missing, ask a short clarifying question instead of calling the tool.",
  "This is a draft for review only. Never say a payment request was created, saved or sent, and never claim funds moved.",
  "Never ask for or accept a wallet address, merchant address, private key or recovery phrase. The receiving wallet is determined by the merchant's signed-in session.",
  "Do not invent amount conversions, customer details or payment references.",
].join("\n");

const PARAMETERS = {
  type: "object",
  properties: {
    amount: {
      type: "string",
      description:
        "Payment amount as a decimal SOL string (for example \"0.5\"). No currency code or symbol.",
    },
    description: {
      type: "string",
      description:
        "Short description of what the customer is paying for, 3-200 characters.",
    },
    customerName: {
      type: "string",
      description: "Optional customer name, at most 80 characters.",
    },
    customerEmail: {
      type: "string",
      description: "Optional customer email address.",
    },
  },
  required: ["amount", "description"],
  additionalProperties: false,
} as const;

type InteractionStepLike = {
  type?: string;
  name?: string;
  arguments?: unknown;
  content?: Array<{ type?: string; text?: string }>;
};

type InteractionLike = {
  output_text?: string;
  steps?: InteractionStepLike[];
};

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(Object.assign(new Error("Gemini did not respond in time."), { code: "ai_timeout" }));
    }, ms);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function classifyFailure(err: unknown): GeminiDraftResult {
  const details = err as { status?: number; message?: string; code?: string | number };
  const status = typeof details?.status === "number" ? details.status : undefined;
  const message = details?.message ?? "The AI service request failed.";
  const lower = message.toLowerCase();

  if (details?.code === "ai_timeout") {
    return { ok: false, code: "upstream_timeout", message };
  }
  if (
    status === 401 ||
    status === 403 ||
    lower.includes("api key") ||
    lower.includes("unauthenticated") ||
    lower.includes("permission denied")
  ) {
    return { ok: false, code: "invalid_api_key", message };
  }
  if (status === 429 || lower.includes("quota") || lower.includes("rate limit")) {
    return { ok: false, code: "quota_exceeded", message };
  }
  if (status === 404 || lower.includes("model")) {
    return { ok: false, code: "model_unavailable", message };
  }
  return { ok: false, code: "upstream_error", message };
}

function buildTranscript(
  message: string,
  history: readonly DraftConversationTurn[],
): string {
  const turns = history
    .filter((turn) => turn.text.trim().length > 0)
    .map((turn) => `${turn.role === "assistant" ? "Assistant" : "Merchant"}: ${turn.text.trim()}`);

  turns.push(`Merchant: ${message.trim()}`);
  return turns.join("\n");
}

function parseArguments(raw: unknown): Record<string, unknown> | null {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }

  if (typeof raw === "string" && raw.trim().length > 0) {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Asks Gemini to extract payment-request details. The response is either a
 * proposed tool call, a normal text reply (for example a clarification), or a
 * classified failure. Nothing is persisted.
 */
export async function proposePaymentRequestDraft({
  message,
  history = [],
}: {
  message: string;
  history?: readonly DraftConversationTurn[];
}): Promise<GeminiDraftResult> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();

  if (!apiKey) {
    return {
      ok: false,
      code: "missing_api_key",
      message: "The AI assistant is not configured on the server.",
    };
  }

  const client = new GoogleGenAI({ apiKey });

  let interaction: InteractionLike;

  try {
    interaction = (await withTimeout(
      client.interactions.create({
        model: DRAFT_GEMINI_MODEL,
        input: buildTranscript(message, history),
        system_instruction: SYSTEM_INSTRUCTION,
        tools: [
          {
            type: "function",
            name: PREPARE_PAYMENT_REQUEST_TOOL,
            description:
              "Prepare a draft payment request for merchant review. This does not create or save anything.",
            parameters: PARAMETERS,
          },
        ],
        store: false,
      }),
      REQUEST_TIMEOUT_MS,
    )) as unknown as InteractionLike;
  } catch (err) {
    return classifyFailure(err);
  }

  const steps = interaction.steps ?? [];
  const toolCall = steps.find(
    (step) =>
      step.type === "function_call" && step.name === PREPARE_PAYMENT_REQUEST_TOOL,
  );

  if (toolCall) {
    const args = parseArguments(toolCall.arguments);

    if (!args) {
      return {
        ok: false,
        code: "invalid_model_response",
        message: "The AI assistant returned an invalid draft. Please try again.",
      };
    }

    return { ok: true, proposal: { kind: "tool_call", arguments: args } };
  }

  const text =
    (typeof interaction.output_text === "string" && interaction.output_text.trim()) ||
    steps
      .filter((step) => step.type === "model_output")
      .flatMap((step) => step.content ?? [])
      .filter((content) => content.type === "text" && typeof content.text === "string")
      .map((content) => content.text)
      .join("\n")
      .trim();

  if (!text) {
    return {
      ok: false,
      code: "invalid_model_response",
      message: "The AI assistant returned an empty response. Please try again.",
    };
  }

  return { ok: true, proposal: { kind: "message", text } };
}
