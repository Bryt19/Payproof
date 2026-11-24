import { NextRequest, NextResponse } from "next/server";
import { requireMerchant } from "@/lib/auth/index";
import {
  checkClientRateLimit,
  checkWalletRateLimit,
  type RateLimitOutcome,
} from "@/lib/auth/rate-limit";
import { resolveDraftTokenSecret, verifyDraftToken } from "./draft-token";
import {
  revokeDraftAuthorization,
  type RevokeAuthorizationResult,
} from "./authorization-registry";
import {
  DRAFT_BODY_TOO_LARGE_MESSAGE,
  draftJson,
  hasJsonContentType,
  isSameOriginRequest,
  readDraftJsonBody,
} from "./draft-http";

/**
 * POST /api/ai/payment-drafts/cancel
 *
 * Revokes the authorization behind a signed draft token so it can no longer be
 * approved, without creating, consuming or modifying any payment request.
 *
 * The request body carries the draft token only. Merchant ownership comes from
 * the authenticated session and is checked twice: against the token signature
 * and again against the stored registry row (inside the locking RPC). Neither
 * the token nor the signing secret is ever logged.
 */

export const CANCEL_RATE_LIMIT_MESSAGE =
  "Too many cancellation attempts. Please try again shortly.";
export const CANCEL_TEMPORARILY_UNAVAILABLE_MESSAGE =
  "Draft cancellation is temporarily unavailable. Please try again shortly.";

export type PaymentDraftCancelDependencies = {
  resolveMerchant: (request: NextRequest) => Promise<string | NextResponse>;
  checkRateLimit: (
    wallet: string,
    request: NextRequest,
  ) => Promise<RateLimitOutcome>;
  revoke: typeof revokeDraftAuthorization;
  draftSecret: () => string | null;
  now: () => Date;
};

function defaultDependencies(): PaymentDraftCancelDependencies {
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
    revoke: (input) => revokeDraftAuthorization(input),
    draftSecret: () => resolveDraftTokenSecret(),
    now: () => new Date(),
  };
}

function tokenFailureResponse(
  reason:
    | "malformed"
    | "invalid_signature"
    | "invalid_payload"
    | "expired"
    | "wrong_merchant",
): NextResponse {
  if (reason === "expired") {
    // The token itself proves the authorization is already unusable. Report the
    // expiry instead of a cancellation, so the UI never shows "cancelled" for a
    // draft the merchant never actually cancelled.
    return draftJson(
      {
        status: "error",
        code: "expired_authorization",
        error:
          "This draft has already expired. Nothing was saved and no payment request was created.",
      },
      410,
    );
  }

  if (reason === "wrong_merchant") {
    // Do not reveal whether another merchant's authorization exists. Return a
    // generic 404 so the UI shows no misleading "cancelled" status.
    return draftJson(
      {
        status: "error",
        code: "authorization_not_found",
        error: "Authorization not found.",
      },
      404,
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
  result: RevokeAuthorizationResult,
): NextResponse {
  // Handle known outcomes even when ok is false (test overrides use this pattern)
  if (!result.ok && "outcome" in result) {
    switch (result.outcome) {
      case "revoked":
      case "unknown":
        return draftJson({ status: "cancelled" });
      case "consumed":
        return draftJson(
          {
            status: "error",
            code: "authorization_consumed",
            error:
              "This draft has already been approved. Check Payments for the created request.",
          },
          409,
        );
      case "processing":
        return NextResponse.json(
          {
            status: "error",
            code: "authorization_processing",
            error:
              "This approval is already being processed. Please check again in a moment.",
          },
          {
            status: 409,
            headers: { "cache-control": "no-store", "retry-after": "1" },
          },
        );
      case "wrong_merchant":
        return draftJson(
          {
            status: "error",
            code: "authorization_not_found",
            error: "Authorization not found.",
          },
          404,
        );
      case "invalid_request":
        return draftJson(
          {
            status: "error",
            code: "invalid_authorization",
            error: "The draft cancellation request was invalid.",
          },
          400,
        );
    }
    // Actual registry failure with no recognized outcome
    return draftJson(
      {
        status: "error",
        code: "registry_unavailable",
        error: CANCEL_TEMPORARILY_UNAVAILABLE_MESSAGE,
      },
      503,
    );
  }

  if (!result.ok) {
    return draftJson(
      {
        status: "error",
        code: "registry_unavailable",
        error: CANCEL_TEMPORARILY_UNAVAILABLE_MESSAGE,
      },
      503,
    );
  }

  switch (result.outcome) {
    case "revoked":
    case "unknown":
      // Both are safe terminal results: the nonce cannot be executed. `unknown`
      // means there is no registry record to revoke, so the token is already
      // unusable and a repeated cancel stays idempotent.
      return draftJson({ status: "cancelled", outcome: "revoked" });
    case "consumed":
      // An approval already created a payment request. Never report this as a
      // successful cancellation.
      return draftJson(
        {
          status: "error",
          code: "authorization_consumed",
          error:
            "This draft has already been approved. Check Payments for the created request.",
        },
        409,
      );
    case "processing":
      return NextResponse.json(
        {
          status: "error",
          code: "authorization_processing",
          error:
            "This approval is already being processed. Please check again in a moment.",
        },
        {
          status: 409,
          headers: { "cache-control": "no-store", "retry-after": "1" },
        },
      );
    case "wrong_merchant":
      // Do not reveal whether another merchant's authorization exists. Return a
      // generic 404 so the UI shows no misleading "cancelled" status.
      return draftJson(
        {
          status: "error",
          code: "authorization_not_found",
          error: "Authorization not found.",
        },
        404,
      );
    case "invalid_request":
      return draftJson(
        {
          status: "error",
          code: "invalid_authorization",
          error: "The draft cancellation request was invalid.",
        },
        400,
      );
  }
}

export function createPaymentDraftCancelHandler(
  overrides: Partial<PaymentDraftCancelDependencies> = {},
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

    if (
      typeof merchantAddress !== "string" ||
      merchantAddress.trim().length === 0
    ) {
      if (merchantAddress instanceof NextResponse) return merchantAddress;
      return draftJson({ error: "Authentication required." }, 401);
    }

    const wallet = merchantAddress.trim();

    const rateLimit = await deps.checkRateLimit(wallet, request);
    if (!rateLimit.ok) {
      if (rateLimit.kind === "limited") {
        return NextResponse.json(
          { error: CANCEL_RATE_LIMIT_MESSAGE },
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
        { error: CANCEL_TEMPORARILY_UNAVAILABLE_MESSAGE },
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

    const draftToken =
      typeof parsedBody.body.draftToken === "string"
        ? parsedBody.body.draftToken.trim()
        : "";

    if (!draftToken) {
      return draftJson({ error: "draftToken is required." }, 400);
    }

    const secret = deps.draftSecret();
    if (!secret) {
      console.error(
        "[ai/payment-drafts/cancel] AI_DRAFT_TOKEN_SECRET is missing or too short.",
      );
      return draftJson(
        { error: "Draft authorization is not configured on the server." },
        503,
      );
    }

    const verified = verifyDraftToken(draftToken, {
      secret,
      now: deps.now(),
      wallet,
    });

    if (!verified.ok) {
      return tokenFailureResponse(verified.reason);
    }

    // The wallet is the authenticated session wallet. Any merchant or wallet
    // field in the body was already ignored by only reading `draftToken`.
    const result = await deps.revoke({
      nonce: verified.payload.nonce,
      merchantWallet: wallet,
    });

    return registryFailureResponse(result);
  };
}
