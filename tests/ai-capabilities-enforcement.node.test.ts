import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { NextRequest } from "next/server";

import { createPaymentIntentPostHandler } from "../src/lib/ai/payment-intent-handler.ts";
import { createPaymentDraftPostHandler } from "../src/lib/ai/payment-draft-handler.ts";
import { createPaymentDraftExecuteHandler } from "../src/lib/ai/payment-draft-execute-handler.ts";
import { createPaymentDraftReauthorizeHandler } from "../src/lib/ai/payment-draft-reauthorize-handler.ts";
import { createPaymentDraftCancelHandler } from "../src/lib/ai/payment-draft-cancel-handler.ts";
import {
  CAPABILITY_DISABLED_CODE,
  CAPABILITY_DISABLED_MESSAGES,
  CAPABILITY_UNAVAILABLE_CODE,
  CAPABILITY_UNAVAILABLE_MESSAGE,
  type CapabilityGateResult,
} from "../src/lib/ai/capability-guard.ts";
import { createDraftToken } from "../src/lib/ai/draft-token.ts";
import { createIntentToken } from "../src/lib/ai/intent-token.ts";
import type { PaymentRequestDraft } from "../src/lib/ai/payment-draft.ts";
import type { PaymentRequest } from "../src/lib/payment-requests/types.ts";
import type { RateLimitOutcome } from "../src/lib/auth/rate-limit.ts";

/**
 * Stage 2: server-side capability enforcement.
 *
 * Every test injects the gate and every downstream dependency, so the assertions
 * are about what was NOT called (provider, token signing, registry, payment
 * request creation) rather than only about the HTTP status.
 */

const SESSION_WALLET = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const OTHER_WALLET = "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1";
const RECIPIENT = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

const NOW = new Date("2026-11-26T10:00:00.000Z");
const NONCE = "a".repeat(32);

const DRAFT_SECRET = "stage-2-enforcement-secret-0123456789abcdef";
const INTENT_SECRET = "stage-2-intent-secret-0123456789abcdefghij";

const DRAFT: PaymentRequestDraft = {
  amountLamports: "1500000000",
  amountSol: "1.5",
  description: "logo design project",
  customerName: null,
  customerEmail: null,
};

const DRAFT_ARGS = {
  amount: "1.5",
  description: "logo design project",
  customerName: null,
  customerEmail: null,
};

const INTENT_MESSAGE = `Send 1.5 SOL to ${RECIPIENT} for the logo design project.`;

const ALLOWED: CapabilityGateResult = { ok: true };
const DISABLED: CapabilityGateResult = { ok: false, reason: "disabled" };
const UNAVAILABLE: CapabilityGateResult = { ok: false, reason: "unavailable" };

function postRequest(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
): NextRequest {
  return new NextRequest(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function gate(
  outcome: CapabilityGateResult | "throw",
  wallets?: string[],
): (wallet: string) => Promise<CapabilityGateResult> {
  return async (wallet: string) => {
    wallets?.push(wallet);
    if (outcome === "throw") throw new Error("capability store unreachable");
    return outcome;
  };
}

/** Asserts the shared 403/503 contract. */
function assertCapabilityResponse(
  response: Response,
  expected: "disabled" | "unavailable",
  capability: "agenticPayments" | "agenticPaymentRequests",
): void {
  assert.equal(response.status, expected === "disabled" ? 403 : 503);
  assert.equal(response.headers.get("cache-control"), "no-store");
}

async function bodyOf(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

function createdRequest(): PaymentRequest {
  return {
    id: "PR-ABCD1234",
    reference: "Fk9Q1uZ8m2Fk9Q1uZ8m2Fk9Q1uZ8m2Fk9Q1uZ8m2",
    amountLamports: "1500000000",
    description: "logo design project",
    customerName: null,
    customerEmail: null,
    merchantAddress: SESSION_WALLET,
    status: "pending",
    transactionSignature: null,
    payerAddress: null,
    verifiedAt: null,
    createdAt: NOW.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Agentic Payments — POST /api/ai/payment-intents
// ---------------------------------------------------------------------------

function intentHandler(config: {
  capability: CapabilityGateResult | "throw";
  counters: { propose: number; authorize: number };
  wallets?: string[];
  rateLimit?: RateLimitOutcome;
  proposeIntent?: () => Promise<{
    ok: true;
    proposal: {
      kind: "tool_call";
      arguments: Record<string, unknown>;
    };
  }>;
}) {
  return createPaymentIntentPostHandler({
    resolveMerchant: async () => SESSION_WALLET,
    checkRateLimit: async () => config.rateLimit ?? { ok: true },
    checkCapability: gate(config.capability, config.wallets),
    proposeIntent: async () => {
      config.counters.propose += 1;

      return (
        config.proposeIntent?.() ??
        Promise.resolve({
          ok: true as const,
          proposal: {
            kind: "tool_call" as const,
            arguments: {
              amount: "1.5",
              recipientAddress: RECIPIENT,
              purpose: "logo design project",
              currency: "SOL",
            },
          },
        })
      );
    },
    authorizeIntent: async ({ intent, merchantWallet, now }) => {
      config.counters.authorize += 1;

      const nonce = "ab".repeat(16);
      const signed = createIntentToken(intent, merchantWallet, {
        secret: INTENT_SECRET,
        now,
        nonce,
      });

      return {
        ok: true,
        token: signed.token,
        expiresAt: signed.expiresAt,
        intent: {
          id: "AI-ENFORCE01",
          merchantWallet,
          status: "draft",
          recipientAddress: intent.recipientAddress ?? "",
          amountLamports: intent.amountLamports,
          purpose: intent.purpose,
          reference: "Fk9Q1uZ8m2Fk9Q1uZ8m2Fk9Q1uZ8m2Fk9Q1uZ8m2",
          sourceKind: intent.sourceKind,
          sourcePaymentRequestReference:
            intent.sourcePaymentRequestReference,
          nonce,
          intentFingerprint: signed.fingerprint,
          transactionSignature: null,
          transactionBase64: null,
          payerAddress: null,
          verifiedAt: null,
          expiresAt: signed.expiresAt,
          createdAt: now.toISOString(),
          approvedAt: null,
          approvalExpiresAt: null,
          submittedAt: null,
          failureReason: null,
        },
      };
    },
    intentSecret: () => INTENT_SECRET,
    now: () => NOW,
  });
}

test("Agentic Payments enabled lets the intent handler complete", async () => {
  const counters = { propose: 0, authorize: 0 };

  const response = await intentHandler({
    capability: ALLOWED,
    counters,
  })(
    postRequest("http://localhost/api/ai/payment-intents", {
      message: INTENT_MESSAGE,
    }),
  );

  assert.equal(response.status, 200);
  assert.equal((await bodyOf(response)).status, "ready");
  assert.equal(counters.propose, 1);
  assert.equal(counters.authorize, 1);
});

test("Agentic Payments disabled returns 403 and never reaches Gemini, OpenRouter or the registry", async () => {
  const counters = { propose: 0, authorize: 0 };
  let geminiCalls = 0;
  let openRouterCalls = 0;

  const handler = intentHandler({
    capability: DISABLED,
    counters,
    // Wires the real provider chain: if the gate let the request through, these
    // counters would move.
    proposeIntent: async () => {
      const { proposePaymentIntent } = await import(
        "../src/lib/ai/payment-intent-provider.ts"
      );

      const result = await proposePaymentIntent(
        { message: INTENT_MESSAGE },
        {
          askGemini: async () => {
            geminiCalls += 1;
            return {
              ok: false as const,
              code: "upstream_error" as const,
              message: "must not be called",
            };
          },
          askOpenRouter: async () => {
            openRouterCalls += 1;
            return { ok: false as const, code: "not_configured" as const };
          },
        },
      );

      // Unreachable when the gate works; keeps the return type honest.
      return result.ok && result.proposal.kind === "tool_call"
        ? { ok: true as const, proposal: result.proposal }
        : Promise.reject(new Error("unexpected provider outcome"));
    },
  });

  const response = await handler(
    postRequest("http://localhost/api/ai/payment-intents", {
      message: INTENT_MESSAGE,
    }),
  );

  assertCapabilityResponse(response, "disabled", "agenticPayments");

  const body = await bodyOf(response);
  assert.equal(body.status, CAPABILITY_DISABLED_CODE);
  assert.equal(body.code, CAPABILITY_DISABLED_CODE);
  assert.equal(body.error, CAPABILITY_DISABLED_MESSAGES.agenticPayments);
  assert.equal("intentToken" in body, false);

  // No provider, no intent authorization, no token.
  assert.equal(geminiCalls, 0);
  assert.equal(openRouterCalls, 0);
  assert.equal(counters.propose, 0);
  assert.equal(counters.authorize, 0);
});

test("an unreadable capability state returns 503 and blocks the intent", async () => {
  const counters = { propose: 0, authorize: 0 };

  const response = await intentHandler({
    capability: UNAVAILABLE,
    counters,
  })(
    postRequest("http://localhost/api/ai/payment-intents", {
      message: INTENT_MESSAGE,
    }),
  );

  assertCapabilityResponse(response, "unavailable", "agenticPayments");

  const body = await bodyOf(response);
  assert.equal(body.status, CAPABILITY_UNAVAILABLE_CODE);
  assert.equal(body.code, CAPABILITY_UNAVAILABLE_CODE);
  assert.equal(body.error, CAPABILITY_UNAVAILABLE_MESSAGE);
  assert.equal("intentToken" in body, false);

  assert.equal(counters.propose, 0);
  assert.equal(counters.authorize, 0);
});

test("a throwing capability dependency fails closed without leaking details", async () => {
  const counters = { propose: 0, authorize: 0 };

  const response = await intentHandler({
    capability: "throw",
    counters,
  })(
    postRequest("http://localhost/api/ai/payment-intents", {
      message: INTENT_MESSAGE,
    }),
  );

  assertCapabilityResponse(response, "unavailable", "agenticPayments");

  const body = await bodyOf(response);
  assert.equal(body.error, CAPABILITY_UNAVAILABLE_MESSAGE);
  assert.equal(JSON.stringify(body).includes("capability store unreachable"), false);
  assert.equal(counters.propose, 0);
  assert.equal(counters.authorize, 0);
});

test("the intent gate uses the session wallet, not a client-supplied address", async () => {
  const counters = { propose: 0, authorize: 0 };
  const wallets: string[] = [];

  const response = await intentHandler({
    capability: DISABLED,
    counters,
    wallets,
  })(
    postRequest("http://localhost/api/ai/payment-intents", {
      message: INTENT_MESSAGE,
      merchantWallet: OTHER_WALLET,
      walletAddress: OTHER_WALLET,
      wallet: OTHER_WALLET,
    }),
  );

  assert.equal(response.status, 403);
  assert.deepEqual(wallets, [SESSION_WALLET]);
});

test("rate limiting still runs before the capability gate", async () => {
  const counters = { propose: 0, authorize: 0 };
  const wallets: string[] = [];

  const response = await intentHandler({
    capability: DISABLED,
    counters,
    wallets,
    rateLimit: { ok: false, kind: "limited", retryAfterSeconds: 30 },
  })(
    postRequest("http://localhost/api/ai/payment-intents", {
      message: INTENT_MESSAGE,
    }),
  );

  assert.equal(response.status, 429);
  assert.equal(wallets.length, 0);
});

// ---------------------------------------------------------------------------
// Agentic Payment Requests — POST /api/ai/payment-drafts
// ---------------------------------------------------------------------------

function draftHandler(config: {
  capability: CapabilityGateResult | "throw";
  counters: { propose: number; token: number; register: number };
  wallets?: string[];
}) {
  return createPaymentDraftPostHandler({
    resolveMerchant: async () => SESSION_WALLET,
    checkRateLimit: async () => ({ ok: true }),
    checkCapability: gate(config.capability, config.wallets),
    proposeDraft: async () => {
      config.counters.propose += 1;
      return {
        ok: true as const,
        proposal: { kind: "tool_call" as const, arguments: DRAFT_ARGS },
      };
    },
    createToken: (draft, wallet, options) => {
      config.counters.token += 1;
      return createDraftToken(draft, wallet, options);
    },
    registerAuthorization: async () => {
      config.counters.register += 1;
      return { ok: true as const };
    },
    draftSecret: () => DRAFT_SECRET,
    now: () => NOW,
  });
}

const DRAFT_REQUEST_BODY = {
  message: "Create a payment request for 1.5 SOL for the logo design project",
};

test("Agentic Payment Requests enabled lets draft creation complete", async () => {
  const counters = { propose: 0, token: 0, register: 0 };

  const response = await draftHandler({ capability: ALLOWED, counters })(
    postRequest("http://localhost/api/ai/payment-drafts", DRAFT_REQUEST_BODY),
  );

  assert.equal(response.status, 200);

  const body = await bodyOf(response);
  assert.equal(body.status, "awaiting_confirmation");
  assert.equal(typeof body.draftToken, "string");

  assert.equal(counters.propose, 1);
  assert.equal(counters.token, 1);
  assert.equal(counters.register, 1);
});

test("Agentic Payment Requests disabled blocks draft creation before any provider, token or registry write", async () => {
  const counters = { propose: 0, token: 0, register: 0 };

  const response = await draftHandler({ capability: DISABLED, counters })(
    postRequest("http://localhost/api/ai/payment-drafts", DRAFT_REQUEST_BODY),
  );

  assertCapabilityResponse(response, "disabled", "agenticPaymentRequests");

  const body = await bodyOf(response);
  assert.equal(body.status, CAPABILITY_DISABLED_CODE);
  assert.equal(body.error, CAPABILITY_DISABLED_MESSAGES.agenticPaymentRequests);
  assert.equal("draftToken" in body, false);
  assert.equal("draft" in body, false);

  assert.equal(counters.propose, 0);
  assert.equal(counters.token, 0);
  assert.equal(counters.register, 0);
});

test("an unreadable capability state blocks draft creation with 503", async () => {
  const counters = { propose: 0, token: 0, register: 0 };

  const response = await draftHandler({ capability: UNAVAILABLE, counters })(
    postRequest("http://localhost/api/ai/payment-drafts", DRAFT_REQUEST_BODY),
  );

  assertCapabilityResponse(response, "unavailable", "agenticPaymentRequests");
  assert.equal((await bodyOf(response)).code, CAPABILITY_UNAVAILABLE_CODE);

  assert.equal(counters.propose, 0);
  assert.equal(counters.token, 0);
  assert.equal(counters.register, 0);
});

test("draft creation fails closed if the capability dependency throws", async () => {
  const counters = { propose: 0, token: 0, register: 0 };

  const response = await draftHandler({ capability: "throw", counters })(
    postRequest("http://localhost/api/ai/payment-drafts", DRAFT_REQUEST_BODY),
  );

  assert.equal(response.status, 503);
  assert.equal(counters.propose, 0);
  assert.equal(counters.token, 0);
  assert.equal(counters.register, 0);
});

test("the draft gate uses the session wallet only", async () => {
  const counters = { propose: 0, token: 0, register: 0 };
  const wallets: string[] = [];

  await draftHandler({ capability: DISABLED, counters, wallets })(
    postRequest("http://localhost/api/ai/payment-drafts", {
      ...DRAFT_REQUEST_BODY,
      walletAddress: OTHER_WALLET,
      merchantAddress: OTHER_WALLET,
    }),
  );

  assert.deepEqual(wallets, [SESSION_WALLET]);
});

// ---------------------------------------------------------------------------
// Execution — POST /api/ai/payment-drafts/execute
// ---------------------------------------------------------------------------

function executeHandler(config: {
  capability: CapabilityGateResult | "throw";
  counters: { execute: number };
  now?: () => Date;
}) {
  return createPaymentDraftExecuteHandler({
    resolveMerchant: async () => SESSION_WALLET,
    checkRateLimit: async () => ({ ok: true }),
    checkCapability: gate(config.capability),
    createAuthorizedRequest: async () => {
      config.counters.execute += 1;
      return {
        ok: true as const,
        request: createdRequest(),
        authorizationOutcome: "created" as const,
      };
    },
    draftSecret: () => DRAFT_SECRET,
    now: config.now ?? (() => NOW),
  });
}

function draftToken(
  options: { wallet?: string; nonce?: string; now?: Date } = {},
): string {
  return createDraftToken(DRAFT, options.wallet ?? SESSION_WALLET, {
    secret: DRAFT_SECRET,
    now: options.now ?? NOW,
    nonce: options.nonce ?? NONCE,
  }).token;
}

test("a draft prepared while enabled cannot execute after the capability is disabled", async () => {
  const counters = { execute: 0 };
  const token = draftToken();

  const response = await executeHandler({ capability: DISABLED, counters })(
    postRequest("http://localhost/api/ai/payment-drafts/execute", {
      draftToken: token,
    }),
  );

  assertCapabilityResponse(response, "disabled", "agenticPaymentRequests");

  const body = await bodyOf(response);
  assert.equal(body.code, CAPABILITY_DISABLED_CODE);
  assert.equal(body.request, undefined);
  assert.equal(body.checkoutUrl, undefined);

  // No payment request was created and no authorization was consumed.
  assert.equal(counters.execute, 0);
});

test("execution returns 503 when the capability state cannot be read", async () => {
  const counters = { execute: 0 };

  const response = await executeHandler({ capability: UNAVAILABLE, counters })(
    postRequest("http://localhost/api/ai/payment-drafts/execute", {
      draftToken: draftToken(),
    }),
  );

  assertCapabilityResponse(response, "unavailable", "agenticPaymentRequests");
  assert.equal(counters.execute, 0);
});

test("execution still succeeds when the capability is enabled", async () => {
  const counters = { execute: 0 };

  const response = await executeHandler({ capability: ALLOWED, counters })(
    postRequest("http://localhost/api/ai/payment-drafts/execute", {
      draftToken: draftToken(),
    }),
  );

  assert.equal(response.status, 201);
  assert.equal((await bodyOf(response)).status, "created");
  assert.equal(counters.execute, 1);
});

test("existing wallet binding is not weakened by the capability gate", async () => {
  const counters = { execute: 0 };

  // A valid, unexpired token signed for a different merchant.
  const otherMerchantToken = draftToken({ wallet: OTHER_WALLET });

  const response = await executeHandler({ capability: ALLOWED, counters })(
    postRequest("http://localhost/api/ai/payment-drafts/execute", {
      draftToken: otherMerchantToken,
    }),
  );

  assert.equal(response.status, 403);

  const body = await bodyOf(response);
  assert.equal(body.code, "wrong_merchant");
  assert.equal(counters.execute, 0);
});

test("an expired draft token is still rejected after the capability check", async () => {
  const counters = { execute: 0 };
  const stale = draftToken({ now: new Date(NOW.getTime() - 60 * 60 * 1000) });

  const response = await executeHandler({ capability: ALLOWED, counters })(
    postRequest("http://localhost/api/ai/payment-drafts/execute", {
      draftToken: stale,
    }),
  );

  assert.equal(response.status, 410);
  assert.equal((await bodyOf(response)).code, "expired_authorization");
  assert.equal(counters.execute, 0);
});

// ---------------------------------------------------------------------------
// Reauthorization — POST /api/ai/payment-drafts/reauthorize
// ---------------------------------------------------------------------------

function reauthorizeHandler(config: {
  capability: CapabilityGateResult | "throw";
  counters: { reauthorize: number; token: number };
}) {
  return createPaymentDraftReauthorizeHandler({
    resolveMerchant: async () => SESSION_WALLET,
    checkRateLimit: async () => ({ ok: true }),
    checkCapability: gate(config.capability),
    reauthorize: async () => {
      config.counters.reauthorize += 1;
      return { ok: true as const, outcome: "reauthorized" as const };
    },
    createToken: (draft, wallet, options) => {
      config.counters.token += 1;
      return createDraftToken(draft, wallet, options);
    },
    draftSecret: () => DRAFT_SECRET,
    now: () => NOW,
  });
}

const REAUTHORIZE_BODY = {
  draftToken: draftToken(),
  draft: {
    amount: "1.5",
    description: "logo design project",
    customerName: "",
    customerEmail: "",
  },
};

test("reauthorization is blocked when Agentic Payment Requests is disabled", async () => {
  const counters = { reauthorize: 0, token: 0 };

  const response = await reauthorizeHandler({
    capability: DISABLED,
    counters,
  })(
    postRequest(
      "http://localhost/api/ai/payment-drafts/reauthorize",
      REAUTHORIZE_BODY,
    ),
  );

  assertCapabilityResponse(response, "disabled", "agenticPaymentRequests");
  assert.equal(counters.token, 0);
  assert.equal(counters.reauthorize, 0);
});

test("reauthorization fails closed when the capability state is unreadable", async () => {
  const counters = { reauthorize: 0, token: 0 };

  const response = await reauthorizeHandler({
    capability: UNAVAILABLE,
    counters,
  })(
    postRequest(
      "http://localhost/api/ai/payment-drafts/reauthorize",
      REAUTHORIZE_BODY,
    ),
  );

  assert.equal(response.status, 503);
  assert.equal(counters.token, 0);
  assert.equal(counters.reauthorize, 0);
});

test("reauthorization still works when the capability is enabled", async () => {
  const counters = { reauthorize: 0, token: 0 };

  const response = await reauthorizeHandler({
    capability: ALLOWED,
    counters,
  })(
    postRequest(
      "http://localhost/api/ai/payment-drafts/reauthorize",
      REAUTHORIZE_BODY,
    ),
  );

  assert.equal(response.status, 200);
  assert.equal((await bodyOf(response)).status, "awaiting_confirmation");
  assert.equal(counters.token, 1);
  assert.equal(counters.reauthorize, 1);
});

// ---------------------------------------------------------------------------
// Cancellation — POST /api/ai/payment-drafts/cancel (never gated)
// ---------------------------------------------------------------------------

function cancelHandler(config: {
  counters: { revoke: number };
  revokeOutcome?: "revoked" | "unknown";
}) {
  return createPaymentDraftCancelHandler({
    resolveMerchant: async () => SESSION_WALLET,
    checkRateLimit: async () => ({ ok: true }),
    revoke: async () => {
      config.counters.revoke += 1;
      return { ok: true as const, outcome: config.revokeOutcome ?? "revoked" };
    },
    draftSecret: () => DRAFT_SECRET,
    now: () => NOW,
  });
}

test("cancellation still works while Agentic Payment Requests is disabled", async () => {
  // The cancel handler has no capability dependency at all, so a merchant can
  // always revoke a draft — there is nothing to disable.
  const counters = { revoke: 0 };

  const response = await cancelHandler({ counters })(
    postRequest("http://localhost/api/ai/payment-drafts/cancel", {
      draftToken: draftToken(),
    }),
  );

  assert.equal(response.status, 200);
  assert.equal((await bodyOf(response)).status, "cancelled");
  assert.equal(counters.revoke, 1);
});

test("cancellation still works when capability storage is unavailable", async () => {
  // No capability read happens on this path, so an unreadable store cannot block
  // a cancellation.
  const counters = { revoke: 0 };

  const response = await cancelHandler({ counters, revokeOutcome: "unknown" })(
    postRequest("http://localhost/api/ai/payment-drafts/cancel", {
      draftToken: draftToken(),
    }),
  );

  assert.equal(response.status, 200);
  assert.equal(counters.revoke, 1);
});

test("cancellation keeps its authentication and ownership checks", async () => {
  const counters = { revoke: 0 };

  const unauthenticated = createPaymentDraftCancelHandler({
    resolveMerchant: async () => {
      throw new Error("auth store down");
    },
    checkRateLimit: async () => ({ ok: true }),
    revoke: async () => {
      counters.revoke += 1;
      return { ok: true as const, outcome: "revoked" as const };
    },
    draftSecret: () => DRAFT_SECRET,
    now: () => NOW,
  });

  const rejected = await unauthenticated(
    postRequest("http://localhost/api/ai/payment-drafts/cancel", {
      draftToken: draftToken(),
    }),
  );
  assert.equal(rejected.status, 503);
  assert.equal(counters.revoke, 0);

  // A token signed for another merchant is not cancellable from this session.
  const crossMerchant = await cancelHandler({ counters })(
    postRequest("http://localhost/api/ai/payment-drafts/cancel", {
      draftToken: draftToken({ wallet: OTHER_WALLET }),
    }),
  );
  assert.equal(crossMerchant.status, 404);
  assert.equal(counters.revoke, 0);
});

// ---------------------------------------------------------------------------
// Isolation
// ---------------------------------------------------------------------------

function readSource(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("the cancel handler and route carry no capability gate", () => {
  for (const file of [
    "../src/lib/ai/payment-draft-cancel-handler.ts",
    "../src/app/api/ai/payment-drafts/cancel/route.ts",
  ]) {
    const source = readSource(file);
    assert.doesNotMatch(source, /checkCapability|checkAiCapability|capability-guard/);
  }
});

test("the customer checkout assistant is untouched by capability enforcement", () => {
  const files = [
    "../src/app/api/pay/[reference]/assist/route.ts",
    "../src/lib/ai/customer-assist-handler.ts",
    "../src/lib/ai/customer-assist-context.ts",
    "../src/components/checkout/chat-widget.tsx",
    "../src/components/checkout/use-chat.ts",
  ];

  for (const file of files) {
    const source = readSource(file);
    assert.doesNotMatch(source, /capability-guard|checkAiCapability|checkMerchantCapability/);
    assert.doesNotMatch(source, /merchant_ai_capabilities/);
    assert.doesNotMatch(source, /requireMerchant/);
  }
});

test("/api/ai/chat enforces only General Assistance", () => {
  const source = readSource("../src/app/api/ai/chat/route.ts");

  // Stage 3 added session authentication and the generalAssistance gate here;
  // the agentic capabilities stay on their own routes.
  assert.match(source, /requireMerchant/);
  assert.match(source, /"generalAssistance"/);
  assert.doesNotMatch(source, /agenticPayments|agenticPaymentRequests/);
  assert.doesNotMatch(
    source,
    /createPaymentIntentPostHandler|createPaymentDraftPostHandler/,
  );
});
