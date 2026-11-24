import { GoogleGenAI, type RetryConfig } from "@google/genai";

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

/**
 * Final application-level boundary around the whole model call. It is only a
 * backstop: the SDK timeout and retry budget below are what normally bound the
 * request. Worst case with those settings is 12s + backoff + 12s.
 */
export const DRAFT_REQUEST_TIMEOUT_MS = 25_000;

/**
 * Per-attempt HTTP timeout handed to the SDK. The SDK enforces it with
 * `AbortSignal.timeout`, so an attempt that stalls is aborted at the socket
 * rather than merely abandoned.
 *
 * A caller-supplied `signal` would *replace* this timeout (the SDK documents
 * that `fetchOptions.signal` takes precedence over `timeout_ms`), so no signal
 * is passed: keeping the real per-attempt abort is the stronger guarantee.
 */
export const DRAFT_SDK_TIMEOUT_MS = 12_000;

/**
 * Explicit, bounded retry budget: at most one retry with 250ms -> 750ms
 * backoff. The SDK default (4 retries, 30s max elapsed, up to 8s between
 * attempts) could outlive the application timeout and leave retries running
 * after the response was already sent.
 */
export const DRAFT_SDK_RETRY_CONFIG: RetryConfig = {
  strategy: "attempt-count-backoff",
  maxRetries: 1,
  backoff: {
    initialInterval: 250,
    maxInterval: 750,
    exponent: 2,
  },
};

/** Per-call options handed to the SDK: bounded timeout and bounded retries. */
export const DRAFT_SDK_REQUEST_OPTIONS: {
  timeout_ms: number;
  retries: RetryConfig;
} = {
  timeout_ms: DRAFT_SDK_TIMEOUT_MS,
  retries: DRAFT_SDK_RETRY_CONFIG,
};

export type DraftConversationTurn = {
  role: "user" | "assistant";
  text: string;
};

export type GeminiDraftProposal =
  | { kind: "tool_call"; arguments: Record<string, unknown> }
  | { kind: "message"; text: string };

export type GeminiDraftFailureCode =
  | "missing_api_key"
  | "invalid_api_key"
  | "quota_exceeded"
  | "model_unavailable"
  | "upstream_timeout"
  | "upstream_unavailable"
  | "invalid_model_response"
  | "upstream_error";

export type GeminiDraftFailure = {
  ok: false;
  code: GeminiDraftFailureCode;
  message: string;
  /** Gemini's HTTP status, when the failure came from an HTTP response. */
  upstreamStatus?: number;
};

export type GeminiDraftResult =
  | { ok: true; proposal: GeminiDraftProposal }
  | GeminiDraftFailure;

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
  // Final safety boundary only. Each HTTP attempt is already bounded by the
  // SDK's own `timeout_ms`, which aborts the request instead of leaking it.
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

/**
 * Maps a failed Gemini call (or the application timeout) onto the small set of
 * failure codes the handler understands. Exported for tests: it is pure.
 */
export function classifyDraftFailure(err: unknown): GeminiDraftFailure {
  const details = err as {
    status?: number;
    message?: string;
    code?: string | number;
    name?: string;
  };
  const status = typeof details?.status === "number" ? details.status : undefined;
  const message = details?.message ?? "The AI service request failed.";
  const lower = message.toLowerCase();

  const fail = (
    code: GeminiDraftFailureCode,
  ): GeminiDraftFailure => ({ ok: false, code, message, upstreamStatus: status });

  // Our own 25s boundary.
  if (details?.code === "ai_timeout") {
    return fail("upstream_timeout");
  }
  // The SDK's per-attempt 12s timeout, aborted via AbortSignal.timeout.
  // `APIConnectionTimeoutError` is what this SDK raises for its own
  // timeout_ms; `RequestTimeoutError` is the lower-level HTTP client error.
  // Neither carries an HTTP status.
  if (
    details?.name === "APIConnectionTimeoutError" ||
    details?.name === "RequestTimeoutError"
  ) {
    return fail("upstream_timeout");
  }
  if (
    status === 401 ||
    status === 403 ||
    lower.includes("api key") ||
    lower.includes("unauthenticated") ||
    lower.includes("permission denied")
  ) {
    return fail("invalid_api_key");
  }
  if (status === 429 || lower.includes("quota") || lower.includes("rate limit")) {
    return fail("quota_exceeded");
  }
  // Status wins over the message heuristics below: an overloaded model can
  // mention "model" in its 5xx body, which must not be reported as missing.
  if (status === 500 || status === 502 || status === 503 || status === 504) {
    return fail("upstream_unavailable");
  }
  if (status === 404 || lower.includes("model")) {
    return fail("model_unavailable");
  }
  return fail("upstream_error");
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
      client.interactions.create(
        {
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
        },
        DRAFT_SDK_REQUEST_OPTIONS,
      ),
      DRAFT_REQUEST_TIMEOUT_MS,
    )) as unknown as InteractionLike;
  } catch (err) {
    return classifyDraftFailure(err);
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
