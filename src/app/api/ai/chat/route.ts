import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Verified against the installed @google/genai SDK: this model is available and
// streams with low latency. gemini-4-hydrogen / gemini-2.0-flash are not
// available on this API key.
const GEMINI_MODEL = "gemini-3.1-flash-lite";

const REQUEST_TIMEOUT_MS = 25_000;
const STREAM_IDLE_TIMEOUT_MS = 30_000;

const SYSTEM_INSTRUCTION = [
  "You are PayProof AI, the assistant built into PayProof, a Solana payment-verification platform for merchants and customers (currently Solana Devnet).",
  "Be friendly, professional and conversational. You can handle ordinary conversation and general knowledge questions, not only PayProof topics.",
  "",
  "What PayProof does:",
  "- Merchants create Payment Requests with an amount in SOL, a description and optional customer details. Each request gets a shareable checkout link (/pay/[reference]) and a unique on-chain reference key.",
  "- Customers connect Phantom, Solflare or another Wallet Standard wallet, sign the transfer on the client, and PayProof's server independently verifies the transaction on Solana Devnet at confirmed commitment.",
  "- Invoices are formal billing documents with itemized lines, tax, due dates and downloadable receipts.",
  "- The dashboard shows requests, payments, pending/verified/failed statuses and analytics. Telegram notifications are optional.",
  "- Private keys never leave the customer's device; PayProof never asks for recovery phrases.",
  "",
  "Rules:",
  "- You do NOT have live access to the merchant's account, database or payment statistics. Never invent amounts, revenue, transaction signatures, wallet addresses, invoice numbers or counts.",
  "- If asked for account-specific figures (for example revenue today, pending payments, failed payments), say plainly that live merchant data is not connected to this chat yet, and point the user to the Dashboard.",
  "- Clearly separate general explanations from anything you might imply about their account.",
  "- If a request is outside what you can do, say so and suggest the closest useful thing.",
  "- Explain technical concepts (blockchain, Solana, wallets, frontend/backend) clearly and concisely.",
  "- Use short paragraphs and bullet points when it helps. Avoid over-explaining.",
].join("\n");

// Gemini API keys exist in more than one format (legacy "AIza..." and newer
// "AQ...." AI Studio keys). Do NOT gate on a prefix.
function isConfiguredGeminiKey(key: string | undefined): key is string {
  return typeof key === "string" && key.trim().length > 0;
}

function geminiKeyDiagnostics() {
  return {
    configured: isConfiguredGeminiKey(process.env.GEMINI_API_KEY),
    envVarPresent: typeof process.env.GEMINI_API_KEY === "string",
    runtime: "nodejs" as const,
    model: GEMINI_MODEL,
  };
}

type GeminiFailureCode =
  | "invalid_api_key"
  | "quota_exceeded"
  | "model_unavailable"
  | "upstream_timeout"
  | "empty_response"
  | "upstream_error";

function classifyGeminiFailure(err: unknown): {
  code: GeminiFailureCode;
  status: number;
  message: string;
} {
  const details = err as {
    status?: number;
    code?: number | string;
    message?: string;
  };
  const rawStatus =
    typeof details?.status === "number" ? details.status : undefined;
  const message = details?.message ?? "The AI service request failed.";
  const lower = message.toLowerCase();

  if (rawStatus === undefined && details?.code === "ai_timeout") {
    return { code: "upstream_timeout", status: 504, message };
  }
  if (
    rawStatus === 401 ||
    rawStatus === 403 ||
    lower.includes("api key") ||
    lower.includes("unauthenticated") ||
    lower.includes("permission denied")
  ) {
    return { code: "invalid_api_key", status: 502, message };
  }
  if (
    rawStatus === 429 ||
    lower.includes("quota") ||
    lower.includes("rate limit") ||
    lower.includes("resource exhausted")
  ) {
    return { code: "quota_exceeded", status: 503, message };
  }
  if (
    rawStatus === 404 ||
    lower.includes("model") ||
    lower.includes("not found")
  ) {
    return { code: "model_unavailable", status: 502, message };
  }
  return { code: "upstream_error", status: 502, message };
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        Object.assign(new Error(label), {
          code: "ai_timeout",
        }),
      );
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

export async function GET() {
  // Safe diagnostic endpoint: booleans only, no key material.
  return NextResponse.json({ ok: true, gemini: geminiKeyDiagnostics() });
}

// Only intercept queries that are clearly about PayProof's own domain. Anything
// else (greetings, general knowledge, follow-ups) goes to Gemini.
function isPayProofRelated(query: string): boolean {
  return /\b(payproof|pay proof|payment|payments|invoice|invoices|merchant|merchants|solana|devnet|solflare|phantom|wallet|wallets|transaction|transactions|telegram|dashboard|revenue|earned|income|pending|refund|verify|verified|verification|checkout|payment request|payment requests)\b/i.test(
    query,
  );
}

// Canned, accurate PayProof answers. These never claim live account data.
function payproofSpecificResponse(query: string): string | null {
  const q = query.toLowerCase();

  if (
    q.includes("revenue") ||
    q.includes("earned") ||
    q.includes("income") ||
    (q.includes("how much") && (q.includes("made") || q.includes("made today")))
  ) {
    return "I don't have live access to your merchant account, so I can't report your revenue for today (or any period) yet — live merchant data is not connected to this chat.\n\nWhat I can tell you:\n- **Verified settlements** are payments independently confirmed on Solana Devnet.\n- **Pending payments** are requests where the customer has not completed checkout.\n- Revenue should only count confirmed, verified transactions to avoid double-counting.\n\nFor exact figures, open the **Dashboard** (Overview and Charts). You can also ask me how revenue is calculated or how to read your transaction statuses.";
  }

  if (q.includes("difference") || (q.includes("invoice") && q.includes("request"))) {
    return "Here is the difference between a **Payment Request** and an **Invoice** in PayProof:\n\n- **Payment Requests** are lightweight, shareable payment links tied to a unique on-chain reference. They are designed for quick peer-to-peer or customer checkouts with instant verification on Solana Devnet.\n- **Invoices** are formal business billing documents with itemized line items, tax breakdowns, due dates, customer billing addresses, and downloadable PDF receipts suitable for corporate accounting.\n\nUse Invoices for formal client billing and Payment Requests for quick checkout links.";
  }

  if (q.includes("create") && (q.includes("request") || q.includes("payment"))) {
    return "To create a new **Payment Request** in PayProof:\n\n1. Navigate to **Payment Requests** in the left sidebar (or use the **New payment** action on the dashboard).\n2. Click **Create Request**.\n3. Enter the amount in **SOL**, an optional customer name/email, and a description (e.g., Invoice #1042 - Consulting).\n4. Submit to generate a unique Solana Devnet payment link and QR code.\n5. Share the checkout link (`/pay/[reference]`) with your customer. When they connect their wallet and sign, PayProof independently verifies the transaction on-chain. Return to the Dashboard to see verification status.";
  }

  if (
    q.includes("verify") ||
    (q.includes("solana") && q.includes("devnet")) ||
    q.includes("how does payproof verify")
  ) {
    return "PayProof uses a **trustless verification model** on Solana Devnet:\n\n1. **Unique Reference Key**: Every payment request embeds a unique public key as a read-only reference instruction in the Solana transaction.\n2. **Client Signing**: The customer connects their Phantom or Solflare wallet and signs the transaction directly. Private keys never leave their device.\n3. **Independent Server Verification**: PayProof's server independently queries the Solana Devnet RPC at confirmed commitment to verify:\n   - Recipient wallet matches the merchant address.\n   - Exact SOL amount transferred.\n   - Reference key is present in transaction account keys.\n4. **Permanent Proof**: Once confirmed on-chain, the transaction signature is stored and verified receipt proof is issued.";
  }

  if (q.includes("pending") || q.includes("need attention")) {
    return "To check payments that need your attention:\n\n- Go to **Dashboard Overview** to review pending requests vs. verified settlements.\n- Open **Payment Requests** and filter by the **Pending** tab to see customers who have not completed checkout.\n- Open **Invoices** to view overdue or draft invoices awaiting dispatch.\n\nA payment remains pending until the customer connects their wallet and signs the transaction on Solana Devnet.";
  }

  if (q.includes("failed") || q.includes("fail")) {
    return "Failed payments on Solana Devnet can happen when:\n\n- The customer's wallet doesn't have enough SOL for the transfer plus the network fee.\n- The payment reference key doesn't match the expected recipient.\n- The transaction was signed but not broadcast before the window closed.\n- The amount sent differs from the requested amount.\n\nCheck the **Payment Request** details in the Dashboard for the failure reason. The customer can retry with the correct amount and a small SOL balance for fees.";
  }

  if (q.includes("telegram")) {
    return "PayProof can send Telegram notifications for payment events:\n\n- Configure your Telegram bot in **Settings → Integrations → Telegram**.\n- Choose events: new payment requests, pending payments, verified settlements, failed payments and overdue invoices.\n- Notifications include the payment link, amount, and a direct button to view the transaction in the Dashboard.\n- Notification data is sent only from your authenticated merchant account.";
  }

  if (q.includes("how does payproof work") || q.includes("what is payproof")) {
    return "PayProof is a **Solana-powered payment verification platform** for merchants and customers:\n\n- **Payment Requests**: shareable checkout links with unique on-chain references.\n- **Independent Verification**: the server verifies transactions on Solana Devnet at confirmed commitment; signing happens in the customer's wallet.\n- **Invoices**: formal billing documents with itemized lines, tax and downloadable receipts.\n- **Dashboard**: overview of requests, payments, statuses and analytics.\n- **Telegram Notifications**: optional real-time alerts.\n- **Security**: no private keys or recovery phrases are stored or transmitted by PayProof.";
  }

  return null;
}

// Clearly-labelled offline content for when the Gemini service is unavailable.
function fallbackResponses(query: string): string | null {
  const offline = payproofSpecificResponse(query);
  if (!offline) return null;
  return `_Offline answer — the live AI service is currently unavailable, so this is a predefined PayProof help answer._\n\n${offline}`;
}

type ChatMessage = { role: "user" | "assistant"; text: string };

function buildTranscript(messages: ChatMessage[]): string {
  const lines = messages
    .filter((m) => typeof m.text === "string" && m.text.trim().length > 0)
    .map(
      (m) =>
        `${m.role === "assistant" ? "Assistant" : "User"}: ${m.text.trim()}`,
    );
  return lines.join("\n");
}

type StreamEvent = {
  event_type?: string;
  type?: string;
  delta?: { type?: string; text?: string };
  step_delta?: { delta?: { type?: string; text?: string } };
  error?: { message?: string; status?: number; code?: string | number };
};

function eventKind(event: StreamEvent): string {
  return event.event_type ?? event.type ?? "";
}

function eventText(event: StreamEvent): string {
  if (eventKind(event) !== "step.delta" && eventKind(event) !== "step_delta") {
    return "";
  }
  const delta = event.delta ?? event.step_delta?.delta;
  if (!delta || delta.type !== "text" || typeof delta.text !== "string") {
    return "";
  }
  return delta.text;
}

function isCompletedEvent(event: StreamEvent): boolean {
  const kind = eventKind(event);
  return kind === "interaction.completed" || kind === "completed";
}

function isErrorEvent(event: StreamEvent): boolean {
  return eventKind(event) === "error";
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { messages } = body as { messages?: ChatMessage[] };

  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json(
      { error: "A conversation history is required." },
      { status: 400 },
    );
  }

  const latestUserMessage =
    [...messages].reverse().find((m) => m.role === "user")?.text?.trim() ?? "";

  if (!latestUserMessage) {
    return NextResponse.json(
      { error: "A valid user message is required." },
      { status: 400 },
    );
  }

  // PayProof-only questions get accurate canned answers, unless they need
  // reasoning (handled by the specific branches above).
  if (isPayProofRelated(latestUserMessage)) {
    const specific = payproofSpecificResponse(latestUserMessage);
    if (specific) {
      return NextResponse.json({ text: specific }, { status: 200 });
    }
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!isConfiguredGeminiKey(apiKey)) {
    return NextResponse.json(
      {
        code: "missing_api_key",
        error:
          "The AI assistant is not configured yet. The server is missing its GEMINI_API_KEY in .env.local.",
        diagnostics: geminiKeyDiagnostics(),
      },
      { status: 503 },
    );
  }

  const client = new GoogleGenAI({ apiKey: apiKey.trim() });
  const transcript = buildTranscript(messages);

  let geminiStream: AsyncIterable<unknown>;
  try {
    geminiStream = (await withTimeout(
      client.interactions.create({
        model: GEMINI_MODEL,
        input: transcript,
        system_instruction: SYSTEM_INSTRUCTION,
        stream: true,
      }),
      REQUEST_TIMEOUT_MS,
      "The AI service did not respond in time.",
    )) as unknown as AsyncIterable<unknown>;
  } catch (err) {
    const fallback = fallbackResponses(latestUserMessage);
    if (fallback) {
      return NextResponse.json({ text: fallback }, { status: 200 });
    }
    const failure = classifyGeminiFailure(err);
    return NextResponse.json(
      { code: failure.code, error: failure.message },
      { status: failure.status },
    );
  }

  const iterator = geminiStream[Symbol.asyncIterator]();

  // Wait for the first text chunk before answering, so we can still return a
  // proper error (empty response, upstream error) with a real HTTP status.
  let firstChunk = "";
  let finished = false;

  try {
    while (!firstChunk) {
      const next = await withTimeout(
        iterator.next(),
        STREAM_IDLE_TIMEOUT_MS,
        "The AI service stopped responding.",
      );
      if (next.done) {
        finished = true;
        break;
      }
      const event = next.value as StreamEvent;

      if (isErrorEvent(event)) {
        const failure = classifyGeminiFailure(event.error);
        const fallback = fallbackResponses(latestUserMessage);
        if (fallback) {
          return NextResponse.json({ text: fallback }, { status: 200 });
        }
        return NextResponse.json(
          { code: failure.code, error: failure.message },
          { status: failure.status },
        );
      }

      const text = eventText(event);
      if (text) {
        firstChunk = text;
      }
      if (isCompletedEvent(event)) {
        finished = true;
      }
    }
  } catch (err) {
    const fallback = fallbackResponses(latestUserMessage);
    if (fallback) {
      return NextResponse.json({ text: fallback }, { status: 200 });
    }
    const failure = classifyGeminiFailure(err);
    return NextResponse.json(
      { code: failure.code, error: failure.message },
      { status: failure.status },
    );
  }

  if (!firstChunk) {
    return NextResponse.json(
      {
        code: "empty_response",
        error:
          "The AI service returned an empty response. Please try again.",
      },
      { status: 502 },
    );
  }

  // Stream the rest of Gemini's output to the browser as it arrives.
  const encoder = new TextEncoder();
  const initial = firstChunk;

  const responseBody = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(initial));

      if (finished) {
        controller.close();
        return;
      }

      void (async () => {
        try {
          while (true) {
            const next = await withTimeout(
              iterator.next(),
              STREAM_IDLE_TIMEOUT_MS,
              "The AI service stopped responding.",
            );
            if (next.done) break;
            const event = next.value as StreamEvent;
            if (isErrorEvent(event)) break;

            const text = eventText(event);
            if (text) {
              controller.enqueue(encoder.encode(text));
            }
            if (isCompletedEvent(event)) break;
          }
        } catch {
          // Response headers are already sent; end the stream cleanly.
        } finally {
          try {
            controller.close();
          } catch {
            // Already closed.
          }
        }
      })();
    },
    cancel() {
      void iterator.return?.(undefined);
    },
  });

  return new Response(responseBody, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
