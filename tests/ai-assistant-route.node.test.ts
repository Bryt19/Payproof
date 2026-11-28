import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { NextRequest, NextResponse } from "next/server";

import {
  ASSISTANT_AUTH_REQUIRED_MESSAGE,
  ASSISTANT_RATE_LIMIT_MESSAGE,
  createAssistantPostHandler,
} from "../src/app/api/ai/assistant/route.ts";
import {
  AMBIGUOUS_PAYMENT_CLARIFICATION,
  ASSISTANT_ROUTE_HEADER,
} from "../src/lib/ai/assistant-routing.ts";

/**
 * The unified assistant endpoint authenticates once, classifies deterministically
 * and delegates. These tests assert which pipeline ran, what it received and —
 * most importantly — which pipelines did not run.
 */

const SESSION_WALLET = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const OTHER_WALLET = "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1";

function request(
  body: unknown,
  headers: Record<string, string> = {},
): NextRequest {
  return new NextRequest("http://localhost/api/ai/assistant", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

type Counters = {
  general: number;
  intents: number;
  drafts: number;
  wallets: string[];
  bodies: Record<string, unknown>[];
};

function newCounters(): Counters {
  return { general: 0, intents: 0, drafts: 0, wallets: [], bodies: [] };
}

function delegatedResponse(text: string): Response {
  return new Response(text, {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

function assistantHandler(
  counters: Counters,
  overrides: {
    resolveMerchant?: () => Promise<string | NextResponse>;
    checkRateLimit?: () => Promise<
      | { ok: true }
      | { ok: false; kind: "limited"; retryAfterSeconds: number }
      | { ok: false; kind: "unavailable" }
    >;
    generalResponse?: (request: NextRequest) => Promise<Response>;
    intentResponse?: (request: NextRequest) => Promise<Response>;
    draftResponse?: (request: NextRequest) => Promise<Response>;
  } = {},
) {
  return createAssistantPostHandler({
    resolveMerchant: overrides.resolveMerchant ?? (async () => SESSION_WALLET),
    checkRateLimit: overrides.checkRateLimit ?? (async () => ({ ok: true })),
    runGeneral: async (req, wallet) => {
      counters.general += 1;
      counters.wallets.push(wallet);
      const body = (await req.json().catch(() => null)) as Record<
        string,
        unknown
      > | null;
      if (body) counters.bodies.push(body);

      return overrides.generalResponse
        ? overrides.generalResponse(req)
        : delegatedResponse("Hello there");
    },
    runPaymentIntent: async (req, wallet) => {
      counters.intents += 1;
      counters.wallets.push(wallet);
      const body = (await req.json().catch(() => null)) as Record<
        string,
        unknown
      > | null;
      if (body) counters.bodies.push(body);

      return overrides.intentResponse
        ? overrides.intentResponse(req)
        : new Response(JSON.stringify({ status: "ready" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
    },
    runPaymentRequest: async (req, wallet) => {
      counters.drafts += 1;
      counters.wallets.push(wallet);
      const body = (await req.json().catch(() => null)) as Record<
        string,
        unknown
      > | null;
      if (body) counters.bodies.push(body);

      return overrides.draftResponse
        ? overrides.draftResponse(req)
        : new Response(JSON.stringify({ status: "awaiting_confirmation" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
    },
  });
}

// ---------------------------------------------------------------------------
// Delegation
// ---------------------------------------------------------------------------

test("a general question is delegated to General Assistance with the transcript", async () => {
  const counters = newCounters();

  const response = await assistantHandler(counters)(
    request({
      message: "How does PayProof work?",
      history: [
        { role: "user", text: "Hi" },
        { role: "assistant", text: "Hello" },
      ],
      walletAddress: OTHER_WALLET,
    }),
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get(ASSISTANT_ROUTE_HEADER), "general");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(await response.text(), "Hello there");

  assert.deepEqual(
    { general: counters.general, intents: counters.intents, drafts: counters.drafts },
    { general: 1, intents: 0, drafts: 0 },
  );
  assert.deepEqual(counters.wallets, [SESSION_WALLET]);

  assert.deepEqual(counters.bodies[0]?.messages, [
    { role: "user", text: "Hi" },
    { role: "assistant", text: "Hello" },
    { role: "user", text: "How does PayProof work?" },
  ]);
});

test("an outbound payment instruction is delegated to the intent handler only", async () => {
  const counters = newCounters();

  const response = await assistantHandler(counters)(
    request({ message: "Send 0.1 SOL to this wallet." }),
  );

  assert.equal(response.headers.get(ASSISTANT_ROUTE_HEADER), "payments");
  assert.deepEqual(
    { general: counters.general, intents: counters.intents, drafts: counters.drafts },
    { general: 0, intents: 1, drafts: 0 },
  );

  // The intent handler receives the same message and history shape it always has.
  assert.deepEqual(counters.bodies[0], {
    message: "Send 0.1 SOL to this wallet.",
    history: [],
  });
});

test("an incoming payment request is delegated to the draft handler only", async () => {
  const counters = newCounters();

  const response = await assistantHandler(counters)(
    request({ message: "Create a payment request for 2 SOL." }),
  );

  assert.equal(response.headers.get(ASSISTANT_ROUTE_HEADER), "payment_requests");
  assert.deepEqual(
    { general: counters.general, intents: counters.intents, drafts: counters.drafts },
    { general: 0, intents: 0, drafts: 1 },
  );
});

test("an ambiguous money instruction asks for a direction and calls no pipeline", async () => {
  const counters = newCounters();

  const response = await assistantHandler(counters)(
    request({ message: "Settle 1 SOL with this customer." }),
  );
  const body = (await response.json()) as Record<string, unknown>;

  assert.equal(response.status, 200);
  assert.equal(response.headers.get(ASSISTANT_ROUTE_HEADER), "clarify");
  assert.equal(body.status, "clarification");
  assert.equal(body.message, AMBIGUOUS_PAYMENT_CLARIFICATION);
  assert.deepEqual(
    { general: counters.general, intents: counters.intents, drafts: counters.drafts },
    { general: 0, intents: 0, drafts: 0 },
  );
});

test("a follow-up to a pending clarification continues that capability", async () => {
  const counters = newCounters();

  await assistantHandler(counters)(
    request({ message: "0.5 SOL", pending: "agenticPaymentRequests" }),
  );

  assert.equal(counters.drafts, 1);
  assert.equal(counters.intents, 0);
  assert.equal(counters.general, 0);

  const second = newCounters();
  await assistantHandler(second)(
    request({
      message: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",
      pending: "agenticPayments",
    }),
  );

  assert.equal(second.intents, 1);
  assert.equal(second.general, 0);
});

test("a client-supplied wallet cannot replace the session wallet", async () => {
  const counters = newCounters();

  await assistantHandler(counters)(
    request({
      message: "Send 0.1 SOL to this wallet.",
      merchantWallet: OTHER_WALLET,
      walletAddress: OTHER_WALLET,
    }),
  );

  assert.deepEqual(counters.wallets, [SESSION_WALLET]);
});

// ---------------------------------------------------------------------------
// Capability enforcement is never bypassed by re-routing
// ---------------------------------------------------------------------------

test("a disabled capability response from the delegated handler passes through untouched", async () => {
  const counters = newCounters();

  const response = await assistantHandler(counters, {
    intentResponse: async () =>
      new Response(
        JSON.stringify({
          status: "capability_disabled",
          code: "capability_disabled",
          error: "Agentic Payments is turned off for this merchant.",
        }),
        { status: 403, headers: { "content-type": "application/json" } },
      ),
  })(request({ message: "Send 0.1 SOL to this wallet." }));
  const body = (await response.json()) as Record<string, unknown>;

  assert.equal(response.status, 403);
  assert.equal(response.headers.get(ASSISTANT_ROUTE_HEADER), "payments");
  assert.equal(body.code, "capability_disabled");
  assert.equal(body.intentToken, undefined);

  // No General Assistance fallback was attempted.
  assert.equal(counters.general, 0);
  assert.equal(counters.intents, 1);
});

test("an unreadable capability response from the delegated handler passes through", async () => {
  const counters = newCounters();

  const response = await assistantHandler(counters, {
    draftResponse: async () =>
      new Response(
        JSON.stringify({
          status: "capability_unavailable",
          code: "capability_unavailable",
          error: "AI capability settings could not be verified right now.",
        }),
        { status: 503, headers: { "content-type": "application/json" } },
      ),
  })(request({ message: "Create a payment request for 2 SOL." }));

  assert.equal(response.status, 503);
  assert.equal(response.headers.get(ASSISTANT_ROUTE_HEADER), "payment_requests");
  assert.equal(counters.general, 0);
});

test("a throwing delegated pipeline becomes a 503, not a general answer", async () => {
  const counters = newCounters();

  const response = await assistantHandler(counters, {
    intentResponse: async () => {
      throw new Error("registry unreachable");
    },
  })(request({ message: "Pay this developer 0.5 SOL." }));
  const body = (await response.json()) as Record<string, unknown>;

  assert.equal(response.status, 503);
  assert.equal(response.headers.get(ASSISTANT_ROUTE_HEADER), "payments");
  assert.equal(JSON.stringify(body).includes("registry unreachable"), false);
  assert.equal(counters.general, 0);
});

// ---------------------------------------------------------------------------
// Authentication and rate limiting
// ---------------------------------------------------------------------------

test("an unauthenticated request never reaches a pipeline", async () => {
  const counters = newCounters();

  const response = await assistantHandler(counters, {
    resolveMerchant: async () =>
      NextResponse.json({ error: ASSISTANT_AUTH_REQUIRED_MESSAGE }, { status: 401 }),
  })(request({ message: "How does PayProof work?" }));

  assert.equal(response.status, 401);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(counters.general + counters.intents + counters.drafts, 0);
});

test("a throwing auth dependency fails closed", async () => {
  const counters = newCounters();

  const response = await assistantHandler(counters, {
    resolveMerchant: async () => {
      throw new Error("session store down");
    },
  })(request({ message: "Hello" }));

  assert.equal(response.status, 503);
  assert.equal(counters.general + counters.intents + counters.drafts, 0);
});

test("rate limiting runs before any pipeline and preserves retry-after", async () => {
  const counters = newCounters();

  const response = await assistantHandler(counters, {
    checkRateLimit: async () => ({
      ok: false,
      kind: "limited",
      retryAfterSeconds: 17,
    }),
  })(request({ message: "Send 0.1 SOL to this wallet." }));
  const body = (await response.json()) as Record<string, unknown>;

  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "17");
  assert.equal(body.error, ASSISTANT_RATE_LIMIT_MESSAGE);
  assert.equal(counters.general + counters.intents + counters.drafts, 0);
});

test("an unreadable rate-limit store fails closed", async () => {
  const counters = newCounters();

  const response = await assistantHandler(counters, {
    checkRateLimit: async () => ({ ok: false, kind: "unavailable" }),
  })(request({ message: "Hello" }));

  assert.equal(response.status, 503);
  assert.equal(counters.general + counters.intents + counters.drafts, 0);
});

// ---------------------------------------------------------------------------
// Request validation
// ---------------------------------------------------------------------------

test("a missing message is rejected before routing", async () => {
  const counters = newCounters();

  const response = await assistantHandler(counters)(request({ history: [] }));

  assert.equal(response.status, 400);
  assert.equal(counters.general + counters.intents + counters.drafts, 0);
});

test("an invalid history is rejected", async () => {
  const counters = newCounters();

  const response = await assistantHandler(counters)(
    request({ message: "Hello", history: [{ role: "system", text: "x" }] }),
  );

  assert.equal(response.status, 400);
  assert.equal(counters.general, 0);
});

test("non-JSON and cross-site requests are rejected", async () => {
  const counters = newCounters();

  const wrongType = await assistantHandler(counters)(
    request({ message: "Hello" }, { "content-type": "text/plain" }),
  );
  assert.equal(wrongType.status, 415);

  const crossSite = await assistantHandler(counters)(
    request({ message: "Hello" }, { "sec-fetch-site": "cross-site" }),
  );
  assert.equal(crossSite.status, 403);

  assert.equal(counters.general, 0);
});

// ---------------------------------------------------------------------------
// No duplicated business logic
// ---------------------------------------------------------------------------

test("the unified route delegates instead of reimplementing the pipelines", () => {
  const source = readFileSync(
    new URL("../src/app/api/ai/assistant/route.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /createAiChatPostHandler/);
  assert.match(source, /createPaymentIntentPostHandler/);
  assert.match(source, /createPaymentDraftPostHandler/);

  // No provider, validation, token or registry logic of its own.
  assert.doesNotMatch(source, /@google\/genai|openrouter|gemini-payment/);
  assert.doesNotMatch(source, /preparePaymentIntent|proposePaymentDraft/);
  assert.doesNotMatch(source, /createDraftToken|registerDraftAuthorization/);
  assert.doesNotMatch(source, /createSupabaseClient/);
});
