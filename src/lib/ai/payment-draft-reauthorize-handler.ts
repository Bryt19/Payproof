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
  verifyDraftToken,
  type CreateDraftTokenResult,
} from "./draft-token";
import {
  preparePaymentDraft,
  type PreparePaymentDraftResult,
} from "./payment-draft";
import {
  draftAuthorizationFingerprint,
  generateDraftNonce,
  reauthorizeDraftAuthorization,
  type ReauthorizeAuthorizationResult,
} from "./authorization-registry";
import {
  DRAFT_BODY_TOO_LARGE_MESSAGE,
  draftJson,
  hasJsonContentType,
  isSameOriginRequest,
  readDraftJsonBody,
} from "./draft-http";

/**
 * POST /api/ai/payment-drafts/reauthorize
 *
 * Re-signs an edited draft. The old nonce is revoked and the new nonce is
 * registered as active in a single SQL transaction; a failed transaction
 * leaves the old authorization untouched. The browser never signs tokens.
 */

export const REAUTHORIZE_RATE_LIMIT_MESSAGE =
  "Too many authorization attempts. Please try again shortly.";
export const REAUTHORIZE_TEMPORARILY_UNAVAILABLE_MESSAGE =
  "Draft authorization is temporarily unavailable. Please try again shortly.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function invalidDraft(prepared: PreparePaymentDraftResult): NextResponse | null {
  if (prepared.status === "clarification") {
    return draftJson(
      {
        status: "invalid",
        code: "missing_fields",
        missing: prepared.missing,
        message: prepared.message,
      },
      422,
    );
  }

  if (prepared.status === "unsupported_currency") {
    return draftJson(
      {
        status: "invalid",
        code: "unsupported_currency",
        message: prepared.message,
      },
      422,
    );
  }

  if (prepared.status === "invalid") {
    return draftJson(
      {
        status: "invalid",
        code: "validation_failed",
        errors: prepared.errors,
        message: prepared.message,
      },
      422,
    );
  }

  return null;
}

export type PaymentDraftReauthorizeDependencies = {
  resolveMerchant: (request: NextRequest) => Promise<string | NextResponse>;
  checkRateLimit: (
    wallet: string,
    request: NextRequest,
  ) => Promise<RateLimitOutcome>;
  reauthorize: typeof reauthorizeDraftAuthorization;
  createToken: typeof createDraftToken;
  draftSecret: () => string | null;
  now: () => Date;
};

function defaultDependencies(): PaymentDraftReauthorizeDependencies {
  return {
    resolveMerchant: (request) => requireMerchant(request),
    checkRateLimit: async (wallet, request) => {
      const client = await checkClientRateLimit(
        "ai-payment-draft-write",
        request.headers,
      );
      if (!client.ok) return client;

      return checkWalletRateLimit("ai-payment-draft-write", wallet);
    },
    reauthorize: (input) => reauthorizeDraftAuthorization(input),
    createToken: (draft, wallet, options) =>
      createDraftToken(draft, wallet, options),
    draftSecret: () => resolveDraftTokenSecret(),
    now: () => new Date(),
  };
}

function tokenFailureResponse(
  reason: "malformed" | "invalid_signature" | "invalid_payload" | "expired" | "wrong_merchant",
): NextResponse {
  if (reason === "expired") {
    return draftJson(
      {
        status: "error",
        code: "expired_authorization",
        error:
          "This draft authorization has expired. Ask PayProof AI to prepare the draft again.",
      },
      410,
    );
  }

  if (reason === "wrong_merchant") {
    return draftJson(
      {
        status: "error",
        code: "wrong_merchant",
        error: "This draft authorization belongs to a different merchant.",
      },
      403,
    );
  }

  return draftJson(
    {
      status: "error",
      code: "invalid_authorization",
      error:
        "This draft authorization is invalid. Ask PayProof AI to prepare the draft again.",
    },
    400,
  );
}

function registryFailureResponse(
  result: ReauthorizeAuthorizationResult,
): NextResponse {
  if (!result.ok) {
    return draftJson(
      {
        status: "error",
        code: "registry_unavailable",
        error: REAUTHORIZE_TEMPORARILY_UNAVAILABLE_MESSAGE,
      },
      503,
    );
  }

  switch (result.outcome) {
    case "unknown":
      return draftJson(
        {
          status: "error",
          code: "unknown_authorization",
          error: "This draft authorization could not be found.",
        },
        404,
      );
    case "wrong_merchant":
      return draftJson(
        {
          status: "error",
          code: "wrong_merchant",
          error: "This draft authorization belongs to a different merchant.",
        },
        403,
      );
    case "revoked":
    case "consumed":
    case "processing":
      return draftJson(
        {
          status: "error",
          code: `authorization_${result.outcome}`,
          error:
            result.outcome === "processing"
              ? "This draft authorization is already being processed."
              : "This draft authorization is no longer active. Ask PayProof AI to prepare the draft again.",
        },
        409,
      );
    case "expired":
      return draftJson(
        {
          status: "error",
          code: "expired_authorization",
          error:
            "This draft authorization has expired. Ask PayProof AI to prepare the draft again.",
        },
        410,
      );
    case "invalid_request":
      return draftJson(
        {
          status: "error",
          code: "invalid_authorization",
          error: "The draft authorization request was invalid.",
        },
        400,
      );
    case "reauthorized":
      return draftJson(
        { status: "error", code: "unexpected", error: "Unexpected state." },
        500,
      );
  }
}

export function createPaymentDraftReauthorizeHandler(
  overrides: Partial<PaymentDraftReauthorizeDependencies> = {},
) {
  return async function POST(request: NextRequest): Promise<NextResponse> {
    const deps = { ...defaultDependencies(), ...overrides };

    let merchantAddress: string | NextResponse;
    try {
      merchantAddress = await deps.resolveMerchant(request);
    } catch {
      return draftJson(
        { error: "Authentication is temporarily unavailable." },
        503,
      );
    }

    if (typeof merchantAddress !== "string" || merchantAddress.trim().length === 0) {
      if (merchantAddress instanceof NextResponse) return merchantAddress;
      return draftJson({ error: "Authentication required." }, 401);
    }

    const wallet = merchantAddress.trim();

    const rateLimit = await deps.checkRateLimit(wallet, request);
    if (!rateLimit.ok) {
      if (rateLimit.kind === "limited") {
        return NextResponse.json(
          { error: REAUTHORIZE_RATE_LIMIT_MESSAGE },
          {
            status: 429,
            headers: {
              "cache-control": "no-store",
              "retry-after": String(rateLimit.retryAfterSeconds),
            },
          },
        );
      }
      return draftJson(
        { error: REAUTHORIZE_TEMPORARILY_UNAVAILABLE_MESSAGE },
        503,
      );
    }

    if (!hasJsonContentType(request)) {
      return draftJson({ error: "Content-Type must be application/json." }, 415);
    }

    if (!isSameOriginRequest(request)) {
      return draftJson({ error: "Cross-origin requests are not allowed." }, 403);
    }

    const parsedBody = await readDraftJsonBody(request);

    if (!parsedBody.ok) {
      return parsedBody.reason === "too_large"
        ? draftJson({ error: DRAFT_BODY_TOO_LARGE_MESSAGE }, 413)
        : draftJson({ error: "The request body must be a JSON object." }, 400);
    }

    const body = parsedBody.body;
    const draftToken =
      typeof body.draftToken === "string" ? body.draftToken.trim() : "";
    const edited = body.draft;

    if (!draftToken) {
      return draftJson({ error: "draftToken is required." }, 400);
    }

    if (!isRecord(edited)) {
      return draftJson({ error: "Edited draft fields are required." }, 400);
    }

    const secret = deps.draftSecret();
    if (!secret) {
      console.error(
        "[ai/payment-drafts/reauthorize] AI_DRAFT_TOKEN_SECRET is missing or too short.",
      );
      return draftJson(
        { error: "Draft authorization is not configured on the server." },
        503,
      );
    }

    const now = deps.now();
    const verified = verifyDraftToken(draftToken, {
      secret,
      now,
      wallet,
    });

    if (!verified.ok) {
      return tokenFailureResponse(verified.reason);
    }

    // Validate the edited fields with the same shared validator used by the
    // creation form and repository. Wallet fields in the body are ignored.
    const prepared = preparePaymentDraft({
      amount: edited.amount,
      description: edited.description,
      customerName: edited.customerName,
      customerEmail: edited.customerEmail,
    });

    const invalid = invalidDraft(prepared);
    if (invalid) return invalid;

    if (prepared.status !== "ready") {
      return draftJson({ error: "The draft is invalid." }, 422);
    }

    const newNonce = generateDraftNonce();
    let signed: CreateDraftTokenResult;

    try {
      signed = deps.createToken(prepared.draft, wallet, {
        secret,
        now,
        nonce: newNonce,
      });
    } catch {
      return draftJson(
        { error: "Could not authorize the edited draft. Please try again." },
        500,
      );
    }

    const result = await deps.reauthorize({
      oldNonce: verified.payload.nonce,
      newNonce,
      merchantWallet: wallet,
      newExpiresAt: signed.expiresAt,
      newFingerprint: draftAuthorizationFingerprint(
        signed.payload.draft,
        wallet,
        newNonce,
      ),
    });

    if (!result.ok || result.outcome !== "reauthorized") {
      return registryFailureResponse(result);
    }

    return draftJson({
      status: "awaiting_confirmation",
      draft: signed.payload.draft,
      draftToken: signed.token,
      expiresAt: signed.expiresAt,
    });
  };
}
