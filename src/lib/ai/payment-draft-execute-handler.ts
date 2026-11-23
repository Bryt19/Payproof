import { NextRequest, NextResponse } from "next/server";
import { requireMerchant } from "@/lib/auth/index";
import {
  checkClientRateLimit,
  checkWalletRateLimit,
  type RateLimitOutcome,
} from "@/lib/auth/rate-limit";
import { getCheckoutPath } from "@/lib/payment-requests/types";
import {
  createPaymentRequestForSession,
  type CreatePaymentRequestResult,
} from "@/lib/payment-requests/create-for-session";
import {
  createPaymentRequestRepository,
  type AuthorizedCreationOutcome,
} from "@/lib/payment-requests/repository";
import {
  resolveDraftTokenSecret,
  verifyDraftToken,
} from "./draft-token";
import { preparePaymentDraft, type PaymentRequestDraft } from "./payment-draft";
import { draftAuthorizationFingerprint } from "./authorization-registry";
import {
  DRAFT_BODY_TOO_LARGE_MESSAGE,
  draftJson,
  hasJsonContentType,
  isSameOriginRequest,
  readDraftJsonBody,
} from "./draft-http";

/**
 * POST /api/ai/payment-drafts/execute
 *
 * Consumes one signed, active authorization and creates exactly one payment
 * request. The signed token payload is the only source of amount, description
 * and customer data; any draft fields, wallet or owner in the request body are
 * ignored.
 *
 * The database function locks the authorization row and performs the insert,
 * consumption and request linkage in one transaction. A retry against a
 * consumed nonce returns the original request instead of creating a duplicate.
 */

export const EXECUTE_RATE_LIMIT_MESSAGE =
  "Too many approval attempts. Please try again shortly.";
export const EXECUTE_TEMPORARILY_UNAVAILABLE_MESSAGE =
  "Payment request creation is temporarily unavailable. Please try again shortly.";

export type PaymentDraftExecuteDependencies = {
  resolveMerchant: (request: NextRequest) => Promise<string | NextResponse>;
  checkRateLimit: (
    wallet: string,
    request: NextRequest,
  ) => Promise<RateLimitOutcome>;
  createAuthorizedRequest: (input: {
    wallet: string;
    draft: PaymentRequestDraft;
    nonce: string;
    fingerprint: string;
  }) => Promise<CreatePaymentRequestResult>;
  draftSecret: () => string | null;
  now: () => Date;
};

function defaultDependencies(): PaymentDraftExecuteDependencies {
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
    createAuthorizedRequest: ({ wallet, draft, nonce, fingerprint }) =>
      createPaymentRequestForSession(
        {
          amountLamports: draft.amountLamports,
          description: draft.description,
          customerName: draft.customerName,
          customerEmail: draft.customerEmail,
        },
        {
          resolveSession: async () => ({
            authenticated: true,
            walletAddress: wallet,
          }),
          openRepository: createPaymentRequestRepository,
          authorization: { nonce, fingerprint },
        },
      ),
    draftSecret: () => resolveDraftTokenSecret(),
    now: () => new Date(),
  };
}

function appBaseUrl(request: NextRequest): string {
  const configuredUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configuredUrl) return configuredUrl;

  const domain = process.env.APP_DOMAIN?.trim();
  if (domain) {
    const isLocal = /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(domain);
    return `${isLocal ? "http" : "https"}://${domain}`;
  }

  return request.nextUrl.origin;
}

function checkoutUrlFor(request: NextRequest, reference: string): string {
  const base = appBaseUrl(request).replace(/\/+$/, "");
  return `${base}${getCheckoutPath(reference)}`;
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

function registryResponse(
  result: CreatePaymentRequestResult,
  request: NextRequest,
): NextResponse {
  if (!result.ok) {
    if (result.reason !== "authorization" || !result.authorizationOutcome) {
      return draftJson(
        {
          status: "error",
          code: "creation_unavailable",
          error: EXECUTE_TEMPORARILY_UNAVAILABLE_MESSAGE,
        },
        503,
      );
    }

    return authorizationFailureResponse(result.authorizationOutcome);
  }

  const outcome = result.authorizationOutcome ?? "created";

  return draftJson(
    {
      status: outcome === "created" ? "created" : "already_created",
      request: result.request,
      checkoutUrl: checkoutUrlFor(request, result.request.reference),
      alreadyCreated: outcome === "already_consumed",
    },
    outcome === "created" ? 201 : 200,
  );
}

function authorizationFailureResponse(
  outcome: Exclude<AuthorizedCreationOutcome, "created" | "already_consumed">,
): NextResponse {
  switch (outcome) {
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
          headers: {
            "cache-control": "no-store",
            "retry-after": "1",
          },
        },
      );
    case "revoked":
      return draftJson(
        {
          status: "error",
          code: "authorization_revoked",
          error:
            "This draft authorization is no longer active. Ask PayProof AI to prepare the draft again.",
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
    case "fingerprint_mismatch":
      return draftJson(
        {
          status: "error",
          code: "authorization_mismatch",
          error:
            "This draft authorization does not match the prepared values. Ask PayProof AI to prepare the draft again.",
        },
        409,
      );
    case "invalid_request":
      return draftJson(
        {
          status: "error",
          code: "invalid_authorization",
          error: "The draft authorization request was invalid.",
        },
        422,
      );
  }
}

export function createPaymentDraftExecuteHandler(
  overrides: Partial<PaymentDraftExecuteDependencies> = {},
) {
  return async function POST(request: NextRequest): Promise<NextResponse> {
    const deps = { ...defaultDependencies(), ...overrides };

    // Re-check the merchant session at execution time; the wallet is never
    // taken from the body or from Gemini.
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
          { error: EXECUTE_RATE_LIMIT_MESSAGE },
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
        { error: EXECUTE_TEMPORARILY_UNAVAILABLE_MESSAGE },
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

    if (!draftToken) {
      return draftJson({ error: "draftToken is required." }, 400);
    }

    const secret = deps.draftSecret();
    if (!secret) {
      console.error(
        "[ai/payment-drafts/execute] AI_DRAFT_TOKEN_SECRET is missing or too short.",
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

    // Re-validate the token payload on the server. The token is the
    // authoritative data source; submitted draft fields are deliberately not
    // read.
    const prepared = preparePaymentDraft({
      amount: verified.payload.draft.amountSol,
      description: verified.payload.draft.description,
      customerName: verified.payload.draft.customerName,
      customerEmail: verified.payload.draft.customerEmail,
    });

    if (prepared.status !== "ready") {
      return draftJson(
        {
          status: "error",
          code: "invalid_draft",
          error:
            "The prepared draft failed validation. Ask PayProof AI to prepare it again.",
        },
        422,
      );
    }

    const fingerprint = draftAuthorizationFingerprint(
      prepared.draft,
      wallet,
      verified.payload.nonce,
    );

    const result = await deps.createAuthorizedRequest({
      wallet,
      draft: prepared.draft,
      nonce: verified.payload.nonce,
      fingerprint,
    });

    return registryResponse(result, request);
  };
}
