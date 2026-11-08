import { NextRequest, NextResponse } from "next/server";

const GENERATION_CONFIG = {
  temperature: 0.7,
  topK: 40,
  topP: 0.95,
  maxOutputTokens: 1024,
};

const SYSTEM_INSTRUCTION = `
You are Payproof's AI Assistant, a merchant-facing assistant inside a Solana payment dashboard.

The user may ask about payments, payment requests, invoices, transactions, and general merchant questions. Answer in a concise, professional tone. Use short paragraphs and bullet points when it helps clarity.

Important rules:
- Do not invent payment amounts, transaction signatures, wallet addresses, invoice numbers, or any other factual Payproof data. If you do not have the information, say that clearly and point the user to the dashboard.
- If the user asks for specific figures you do not have, do not guess. Say you do not have live access and direct them to the dashboard overview.
- If the user asks for something you cannot do, say so plainly and suggest the closest thing you can help with.
- Keep responses helpful but restrained. Do not over-explain.
- If the user asks about Solana, Solana Devnet, Phantom, or on-chain payments, you may answer generally.
- Code samples are allowed when the user asks for them.
`.trim();

/**
 * Built-in merchant assistant fallback for standard Payproof queries in case the
 * external LLM API is temporarily unreachable or API key credentials require adjustment.
 */
function getMerchantFallbackResponse(userQuery: string): string | null {
  const query = userQuery.toLowerCase();

  if (query.includes("create") && (query.includes("request") || query.includes("payment"))) {
    return `To create a new **Payment Request** in Payproof:

1. Navigate to **Payment Requests** in the left sidebar (or click the "+" Create quick action).
2. Click **Create Request**.
3. Enter the amount in **SOL**, an optional customer name/email, and a description (e.g., "Invoice #1042 - Consulting").
4. Submit to generate a unique Solana Devnet payment link and QR code.
5. Share the checkout link (\`/pay/[reference]\`) with your customer. When they connect their wallet and sign, PayProof independently verifies the transaction on-chain.`;
  }

  if (query.includes("difference") && query.includes("invoice") && query.includes("request")) {
    return `Here is the difference between a **Payment Request** and an **Invoice** in Payproof:

- **Payment Requests** are lightweight, shareable payment links tied to a unique on-chain reference. They are designed for quick peer-to-peer or customer checkouts with instant verification on Solana Devnet.
- **Invoices** are formal business billing documents with itemized line items, tax breakdowns, due dates, customer billing addresses, and downloadable PDF receipts suitable for corporate accounting.`;
  }

  if (query.includes("verify") || (query.includes("solana") && query.includes("devnet"))) {
    return `Payproof uses a **trustless verification model** on Solana Devnet:

1. **Unique Reference Key**: Every payment request embeds a unique public key as a read-only reference instruction in the Solana transaction.
2. **Client Signing**: The customer connects their Phantom or Solflare wallet and signs the transaction directly. Private keys never leave their device.
3. **Independent Server Verification**: Payproof's server independently queries the Solana Devnet RPC at \`confirmed\` commitment to verify:
   - Recipient wallet matches the merchant address.
   - Exact SOL amount transferred.
   - Reference key is present in transaction account keys.
4. **Permanent Proof**: Once confirmed on-chain, the transaction signature is stored and verified receipt proof is issued.`;
  }

  if (query.includes("attention") || query.includes("pending")) {
    return `To check payments that need your attention:

- Go to **Dashboard Overview** to review pending requests vs. verified settlements.
- Open **Payment Requests** and filter by the **Pending** tab to see customers who have not completed their checkout.
- Open **Invoices** to view overdue or draft invoices awaiting dispatch.`;
  }

  if (query.includes("draft") && query.includes("invoice")) {
    return `Here is a structured draft you can use for your invoice:

**Invoice Draft**:
- **Invoice Number**: INV-${new Date().getFullYear()}-001
- **Date**: ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
- **Payment Method**: Solana Devnet (SOL)
- **Line Items**:
  1. Web Development & Integration Services — 1.50 SOL
  2. UI/UX Design & Dashboard Implementation — 1.00 SOL
- **Total Due**: 2.50 SOL

You can create this directly in Payproof by going to **Invoices → Create Invoice**.`;
  }

  return null;
}

function parseGeminiError(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as {
      error?: {
        message?: string;
        status?: string;
        code?: number;
      };
    };
    return parsed.error?.message ?? null;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);

  if (!body || typeof body !== "object") {
    return NextResponse.json(
      { error: "Invalid request body." },
      { status: 400 },
    );
  }

  const { messages } = body as {
    messages?: Array<{ role: "user" | "assistant"; text: string }>;
  };

  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json(
      { error: "A conversation history is required." },
      { status: 400 },
    );
  }

  const latestUserMessage =
    [...messages].reverse().find((m) => m.role === "user")?.text?.trim() ?? "";

  const apiKey = process.env.GEMINI_API_KEY;

  if (typeof apiKey !== "string" || apiKey.trim().length === 0) {
    // If no key is set, try fallback responder first
    const fallback = getMerchantFallbackResponse(latestUserMessage);
    if (fallback) {
      return NextResponse.json({ text: fallback });
    }

    return NextResponse.json(
      {
        error:
          "The AI assistant is not configured yet. The server is missing its GEMINI_API_KEY in .env.local.",
      },
      { status: 503 },
    );
  }

  const safeKey = apiKey.trim();
  const lastFour = safeKey.length >= 4 ? safeKey.slice(-4) : "";
  const maskedKey = `...${lastFour}`;

  // 1. Build properly alternating contents array required by Gemini REST API
  const contents: Array<{
    role: "user" | "model";
    parts: Array<{ text: string }>;
  }> = [];

  for (const message of messages) {
    const text = message.text?.trim();
    if (!text) continue;

    const role = message.role === "assistant" ? "model" : "user";
    const last = contents[contents.length - 1];

    if (last && last.role === role) {
      last.parts.push({ text });
    } else {
      contents.push({
        role,
        parts: [{ text }],
      });
    }
  }

  // Gemini requires the first turn in contents to be 'user'
  while (contents.length > 0 && contents[0].role !== "user") {
    contents.shift();
  }

  if (contents.length === 0) {
    return NextResponse.json(
      { error: "A valid user message is required." },
      { status: 400 },
    );
  }

  // 2. Prepare request payload with systemInstruction at the root level
  const requestPayload = {
    systemInstruction: {
      parts: [{ text: SYSTEM_INSTRUCTION }],
    },
    contents,
    generationConfig: GENERATION_CONFIG,
  };

  // Try gemini-2.0-flash first, and fall back to gemini-1.5-flash if needed
  const modelsToTry = ["gemini-2.0-flash", "gemini-1.5-flash"];

  for (const model of modelsToTry) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(safeKey)}`;

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": safeKey,
        },
        body: JSON.stringify(requestPayload),
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => "");
        const parsedMessage =
          errorBody.length > 0 ? parseGeminiError(errorBody) : null;

        const detailedMessage =
          parsedMessage ?? `Gemini request failed with status ${response.status}`;

        console.error(
          `[ai/chat] ${model} error (${response.status}):`,
          detailedMessage,
          `key=${maskedKey}`,
        );

        // If this model is 404 or 400, try the next model in the list
        if (response.status === 404 && model !== modelsToTry[modelsToTry.length - 1]) {
          continue;
        }

        // If the error is an invalid API key, provide a clear diagnostic
        if (
          detailedMessage.toLowerCase().includes("api key not valid") ||
          detailedMessage.toLowerCase().includes("api_key_invalid") ||
          response.status === 400 ||
          response.status === 403
        ) {
          const fallback = getMerchantFallbackResponse(latestUserMessage);
          if (fallback) {
            return NextResponse.json({
              text: `${fallback}\n\n---\n*Note: Using Payproof Assistant offline knowledge base. To enable full Gemini generative capabilities, verify your \`GEMINI_API_KEY\` in \`.env.local\` from https://aistudio.google.com/app/apikey.*`,
            });
          }

          return NextResponse.json(
            {
              error: `Gemini API authentication failed: ${detailedMessage}. Please ensure a valid Google Gemini API key is configured in .env.local.`,
            },
            { status: 502 },
          );
        }

        // For other errors, check fallback first
        const fallback = getMerchantFallbackResponse(latestUserMessage);
        if (fallback) {
          return NextResponse.json({ text: fallback });
        }

        return NextResponse.json(
          {
            error: detailedMessage,
          },
          { status: 502 },
        );
      }

      const result = (await response.json()) as {
        candidates?: Array<{
          content?: {
            parts?: Array<{ text?: string }>;
          };
        }>;
        error?: { message?: string };
      };

      if (result.error) {
        console.error(
          `[ai/chat] ${model} returned an error:`,
          result.error.message,
          `key=${maskedKey}`,
        );

        const fallback = getMerchantFallbackResponse(latestUserMessage);
        if (fallback) {
          return NextResponse.json({ text: fallback });
        }

        return NextResponse.json(
          { error: result.error.message ?? "The AI assistant could not generate a response." },
          { status: 502 },
        );
      }

      const candidate = result.candidates?.[0];
      const content = candidate?.content;
      const parts = content?.parts ?? [];
      const text = parts.map((part) => part.text ?? "").join("").trim();

      if (!text) {
        const fallback = getMerchantFallbackResponse(latestUserMessage);
        if (fallback) {
          return NextResponse.json({ text: fallback });
        }

        return NextResponse.json(
          { error: "The AI assistant returned an empty response." },
          { status: 502 },
        );
      }

      return NextResponse.json({ text });
    } catch (error) {
      console.error(
        `[ai/chat] Failure connecting to ${model}:`,
        error instanceof Error ? error.message : "unknown error",
        `key=${safeKey.slice(-4)}`,
      );

      // Check fallback before failing
      const fallback = getMerchantFallbackResponse(latestUserMessage);
      if (fallback) {
        return NextResponse.json({ text: fallback });
      }

      return NextResponse.json(
        {
          error:
            "Could not reach the AI assistant service. Please check your network connection and try again.",
        },
        { status: 502 },
      );
    }
  }

  return NextResponse.json(
    { error: "The AI assistant could not generate a response right now." },
    { status: 502 },
  );
}
