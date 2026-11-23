import { NextRequest, NextResponse } from "next/server";
import { requireMerchant } from "@/lib/auth/index";
import {
  checkClientRateLimit,
  checkWalletRateLimit,
  type RateLimitOutcome,
} from "@/lib/auth/rate-limit";
import {
  createDraftToken,
  resolveDraftTokenSecret,
  type CreateDraftTokenResult,
} from "./draft-token";
import {
  detectUnsupportedCurrency,
  preparePaymentDraft,
  UNSUPPORTED_CURRENCY_MESSAGE,
  type PaymentDraftArguments,
} from "./payment-draft";
import {
  proposePaymentRequestDraft,
  type DraftConversationTurn,
  type GeminiDraftResult,
} from "./gemini-payment-draft";
import {
  draftAuthorizationFingerprint,
  generateDraftNonce,
  registerDraftAuthorization,
  type RegisterAuthorizationResult,
} from "./authorization-registry";
import {
  DRAFT_BODY_TOO_LARGE_MESSAGE,
  MAX_DRAFT_PREPARE_BODY_BYTES,
  readDraftJsonBody,
} from "./draft-http";

/**
 * Authenticated payment-request draft preparation.
 *
 * The endpoint only prepares, validates and signs a draft. It imports no
 * repository and no creation function. Before returning any token it registers
 * the nonce as an active authorization; if that registration fails, no usable
 * token is returned.
 *
 * Merchant ownership is taken exclusively from the validated session. A wallet
 * in the body, in the conversation, or in the model's tool arguments is
 * ignored.
 */

export const AI_DRAFT_RATE_LIMIT_MESSAGE =
  "Too many payment draft requests. Please try again shortly.";
export const AI_DRAFT_RATE_LIMIT_UNAVAILABLE_MESSAGE =
  "Draft preparation is temporarily unavailable. Please try again shortly.";
export const AI_DRAFT_NOT_CONFIGURED_MESSAGE =
  "Draft preparation is not configured on the server.";
export const AI_DRAFT_AUTH_UNAVAILABLE_MESSAGE =
  "Authentication is temporarily unavailable.";

const NO_STORE = { "cache-control": "no-store" } as const;
const MAX_MESSAGE_LENGTH = 2_000;
const MAX_HISTORY_TURNS = 20;
const MAX_HISTORY_TURN_LENGTH = 2_000;

export type PaymentDraftHandlerDependencies = {
  /** Returns the authenticated wallet, or the auth failure response. */
  resolveMerchant: (request: NextRequest) => Promise<string | NextResponse>;
  /** Client-IP and wallet buckets for this action. */
  checkRateLimit: (
    wallet: string,
    request: NextRequest,
  ) => Promise<RateLimitOutcome>;
  proposeDraft: (input: {
    message: string;
    history: DraftConversationTurn[];
  }) => Promise<GeminiDraftResult>;
  createToken: (
    draft: Parameters<typeof createDraftToken>[0],
    wallet: string,
    options: { secret: string; now: Date; nonce: string },
  ) => CreateDraftTokenResult;
  registerAuthorization: (input: {
    nonce: string;
    merchantWallet: string;
    expiresAt: string;
    fingerprint: string;
  }) => Promise<RegisterAuthorizationResult>;
  draftSecret: () => string | null;
  now: () => Date;
};

function defaultDependencies(): PaymentDraftHandlerDependencies {
  return {
    resolveMerchant: (request) => requireMerchant(request),
    checkRateLimit: async (wallet, request) => {
      const client = await checkClientRateLimit(
        "ai-payment-draft",
        request.headers,
      );
      if (!client.ok) return client;

      return checkWalletRateLimit("ai-payment-draft", wallet);
    },
    proposeDraft: ({ message, history }) =>
      proposePaymentRequestDraft({ message, history }),
    createToken: (draft, wallet, options) =>
      createDraftToken(draft, wallet, options),
    registerAuthorization: (input) => registerDraftAuthorization(input),
    draftSecret: () => resolveDraftTokenSecret(),
    now: () => new Date(),
  };
}

function json(
  body: Record<string, unknown>,
  status = 200,
): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

function hasJsonContentType(request: NextRequest): boolean {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  return contentType.startsWith("application/json");
}

/**
 * Rejects browser cross-site requests. Non-browser clients normally omit both
 * headers; the session cookie is httpOnly + SameSite=Lax, and a JSON request
 * requires a CORS preflight, so absence is not treated as cross-site.
 */
function isSameOrigin(request: NextRequest): boolean {
  const fetchSite = request.headers.get("sec-fetch-site");

  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    return false;
  }

  const origin = request.headers.get("origin");
  if (!origin) return true;

  try {
    const parsed = new URL(origin);
    const configuredDomain = process.env.APP_DOMAIN?.trim();

    return (
      parsed.host === request.nextUrl.host ||
      (Boolean(configuredDomain) && parsed.host === configuredDomain)
    );
  } catch {
    return false;
  }
}

function parseHistory(raw: unknown): DraftConversationTurn[] | null {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) return null;
  if (raw.length > MAX_HISTORY_TURNS) return null;

  const history: DraftConversationTurn[] = [];

  for (const entry of raw) {
    if (!entry || typeof entry !== "object") return null;

    const candidate = entry as { role?: unknown; text?: unknown };
    if (candidate.role !== "user" && candidate.role !== "assistant") {
      return null;
    }
    if (typeof candidate.text !== "string") return null;
    if (candidate.text.length > MAX_HISTORY_TURN_LENGTH) return null;

    const text = candidate.text.trim();
    if (!text) continue;

    history.push({ role: candidate.role, text });
  }

  return history;
}

/**
 * Builds the route handler. Exported with injectable dependencies so the
 * security properties (session ownership, no persistence, token binding) are
 * directly testable.
 */
export function createPaymentDraftPostHandler(
  overrides: Partial<PaymentDraftHandlerDependencies> = {},
) {
  return async function POST(request: NextRequest): Promise<NextResponse> {
    const deps = { ...defaultDependencies(), ...overrides };

    // 1. Authenticate first. Every failure is the auth layer's own response.
    let merchantAddress: string | NextResponse;

    try {
      merchantAddress = await deps.resolveMerchant(request);
    } catch {
      return json({ error: AI_DRAFT_AUTH_UNAVAILABLE_MESSAGE }, 503);
    }

    if (typeof merchantAddress !== "string" || merchantAddress.trim().length === 0) {
      if (merchantAddress instanceof NextResponse) {
        return merchantAddress;
      }
      return json({ error: AI_DRAFT_AUTH_UNAVAILABLE_MESSAGE }, 401);
    }

    const wallet = merchantAddress.trim();

    // 2. Rate limit the authenticated client and wallet.
    const rateLimit = await deps.checkRateLimit(wallet, request);

    if (!rateLimit.ok) {
      if (rateLimit.kind === "limited") {
        return NextResponse.json(
          { error: AI_DRAFT_RATE_LIMIT_MESSAGE },
          {
            status: 429,
            headers: {
              ...NO_STORE,
              "retry-after": String(rateLimit.retryAfterSeconds),
            },
          },
        );
      }

      return json({ error: AI_DRAFT_RATE_LIMIT_UNAVAILABLE_MESSAGE }, 503);
    }

    // 3. Only JSON from the same origin.
    if (!hasJsonContentType(request)) {
      return json(
        { error: "Content-Type must be application/json." },
        415,
      );
    }

    if (!isSameOrigin(request)) {
      return json({ error: "Cross-origin requests are not allowed." }, 403);
    }

    // 4. Parse only the conversation fields. Any wallet, merchantAddress or
    //    other owner-shaped field in the body is ignored.
    const parsedBody = await readDraftJsonBody(
      request,
      MAX_DRAFT_PREPARE_BODY_BYTES,
    );

    if (!parsedBody.ok) {
      return parsedBody.reason === "too_large"
        ? json({ error: DRAFT_BODY_TOO_LARGE_MESSAGE }, 413)
        : json({ error: "The request body must be a JSON object." }, 400);
    }

    const body = parsedBody.body;
    const message =
      typeof body.message === "string" ? body.message.trim() : "";

    if (!message) {
      return json({ error: "A message is required." }, 400);
    }

    if (message.length > MAX_MESSAGE_LENGTH) {
      return json(
        { error: `Message must be ${MAX_MESSAGE_LENGTH} characters or fewer.` },
        400,
      );
    }

    const history = parseHistory(body.history);

    if (!history) {
      return json(
        { error: "Conversation history is invalid." },
        400,
      );
    }

    // 5. A non-SOL amount is answered deterministically. No model call, no
    //    conversion and no draft. An explicit SOL amount wins, so a currency
    //    word inside the description (for example "$5 discount") does not
    //    block an otherwise valid SOL request.
    const hasExplicitSolAmount = /\b\d+(?:\.\d{1,9})?\s*sol\b/i.test(message);
    const unsupportedCurrency = hasExplicitSolAmount
      ? null
      : detectUnsupportedCurrency(message);

    if (unsupportedCurrency) {
      return json({
        status: "unsupported_currency",
        currency: unsupportedCurrency,
        message: UNSUPPORTED_CURRENCY_MESSAGE,
      });
    }

    // 6. Draft tokens require a dedicated server secret. Fail closed.
    const secret = deps.draftSecret();

    if (!secret) {
      console.error(
        "[ai/payment-drafts] AI_DRAFT_TOKEN_SECRET is missing or too short; refusing to sign drafts.",
      );
      return json({ error: AI_DRAFT_NOT_CONFIGURED_MESSAGE }, 503);
    }

    // 7. Ask Gemini for a proposal. The wallet is never sent to the model.
    let proposal: GeminiDraftResult;

    try {
      proposal = await deps.proposeDraft({ message, history });
    } catch {
      return json(
        {
          status: "error",
          code: "upstream_error",
          error: "The AI assistant is temporarily unavailable. Please try again.",
        },
        502,
      );
    }

    if (!proposal.ok) {
      const status =
        proposal.code === "upstream_timeout"
          ? 504
          : proposal.code === "missing_api_key"
            ? 503
            : proposal.code === "quota_exceeded"
              ? 503
              : 502;

      return json(
        {
          status: "error",
          code: proposal.code,
          error:
            proposal.code === "missing_api_key"
              ? "The AI assistant is not configured on the server."
              : proposal.code === "quota_exceeded"
                ? "The AI assistant is busy. Please try again shortly."
                : proposal.code === "upstream_timeout"
                  ? "The AI assistant took too long to respond. Please try again."
                  : "The AI assistant could not prepare a draft. Please try again.",
        },
        status,
      );
    }

    // A plain reply (for example a clarification written by Gemini) is passed
    // through; it never contains a token.
    if (proposal.proposal.kind === "message") {
      return json({
        status: "clarification",
        missing: [],
        message: proposal.proposal.text,
      });
    }

    const args = proposal.proposal.arguments as PaymentDraftArguments;
    const prepared = preparePaymentDraft(args);

    if (prepared.status === "clarification") {
      return json({
        status: "clarification",
        missing: prepared.missing,
        message: prepared.message,
      });
    }

    if (prepared.status === "unsupported_currency") {
      return json({
        status: "unsupported_currency",
        currency: prepared.currency,
        message: prepared.message,
      });
    }

    if (prepared.status === "invalid") {
      return json(
        {
          status: "invalid",
          errors: prepared.errors,
          message: prepared.message,
        },
        422,
      );
    }

    // 8. Sign the validated draft for this session's wallet only, then persist
    //    the nonce as an active authorization. If registration fails, the
    //    token is discarded and never returned.
    let signed: CreateDraftTokenResult;
    const nonce = generateDraftNonce();

    try {
      signed = deps.createToken(prepared.draft, wallet, {
        secret,
        now: deps.now(),
        nonce,
      });
    } catch {
      return json({ error: "Could not prepare the draft. Please try again." }, 500);
    }

    const registration = await deps.registerAuthorization({
      nonce,
      merchantWallet: wallet,
      expiresAt: signed.expiresAt,
      fingerprint: draftAuthorizationFingerprint(
        signed.payload.draft,
        wallet,
        nonce,
      ),
    });

    if (!registration.ok) {
      return json(
        {
          status: "error",
          code: "authorization_unavailable",
          error:
            "The draft authorization could not be stored. Nothing was created. Please try again.",
        },
        503,
      );
    }

    return json({
      status: "awaiting_confirmation",
      draft: prepared.draft,
      draftToken: signed.token,
      expiresAt: signed.expiresAt,
    });
  };
}
