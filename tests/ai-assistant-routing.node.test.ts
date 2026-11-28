import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  AMBIGUOUS_PAYMENT_CLARIFICATION,
  assistantCapabilityForRoute,
  classifyAssistantInstruction,
  isPaymentRoute,
  parsePendingCapability,
} from "../src/lib/ai/assistant-routing.ts";
import {
  AI_SETTINGS_HREF,
  ASSISTANT_CAPABILITIES_SIGN_IN_MESSAGE,
  ASSISTANT_CAPABILITIES_UNAVAILABLE_MESSAGE,
  capabilityTagViews,
  fetchAssistantCapabilityState,
  isCapabilityEnabled,
  type AssistantCapabilityState,
} from "../src/lib/ai/assistant-capabilities.ts";
import {
  parseIntentPreparationResponse,
  readIntentAuthorizationToken,
} from "../src/lib/ai/assistant-intent-preview.ts";

/**
 * Stage 3 routing + status tags.
 *
 * Routing must be deterministic, must never depend on a UI mode and must never
 * treat a payment instruction as a general question.
 */

// ---------------------------------------------------------------------------
// Automatic routing
// ---------------------------------------------------------------------------

const GENERAL_INSTRUCTIONS = [
  "Explain my recent payment activity.",
  "How does PayProof work?",
  "Help me understand my dashboard.",
  "Explain Solana transaction fees.",
  "Can you tell me how payproof verifies payments?",
  "How do I send SOL to a developer?",
  "",
  "   ",
];

const OUTBOUND_INSTRUCTIONS = [
  "Send 0.1 SOL to this wallet.",
  "Pay this developer 0.5 SOL.",
  "Transfer 1 SOL to the following recipient.",
  "send 0.25 sol to 9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",
  "Refund this customer 1 SOL.",
  "Pay this vendor 2 SOL",
];

const INCOMING_INSTRUCTIONS = [
  "Create a payment request for 2 SOL.",
  "Request 0.5 SOL from this customer.",
  "Prepare an invoice for this customer.",
  "Generate a payment link for 1 SOL.",
  "Send a payment request for 1 SOL.",
  "Charge this customer 2 SOL.",
];

const AMBIGUOUS_INSTRUCTIONS = [
  "Settle 1 SOL with this customer.",
  "Send or request 2 SOL from this customer.",
  "Handle 0.5 SOL with this client.",
];

test("ordinary questions and explanations route to General Assistance", () => {
  for (const message of GENERAL_INSTRUCTIONS) {
    assert.equal(classifyAssistantInstruction(message), "general", message);
  }
});

test("outbound payment instructions route to Agentic Payments", () => {
  for (const message of OUTBOUND_INSTRUCTIONS) {
    assert.equal(classifyAssistantInstruction(message), "payments", message);
  }
});

test("incoming payment instructions route to Agentic Payment Requests", () => {
  for (const message of INCOMING_INSTRUCTIONS) {
    assert.equal(
      classifyAssistantInstruction(message),
      "payment_requests",
      message,
    );
  }
});

test("an instruction with no clear direction asks the merchant to clarify", () => {
  for (const message of AMBIGUOUS_INSTRUCTIONS) {
    assert.equal(classifyAssistantInstruction(message), "clarify", message);
  }
});

test("a request for a payment request is never treated as an outbound payment", () => {
  assert.equal(
    classifyAssistantInstruction("Send a payment request for 1 SOL to Maria"),
    "payment_requests",
  );
});

test("a pending capability clarification continues that capability", () => {
  assert.equal(
    classifyAssistantInstruction("0.5 SOL", { pending: "agenticPaymentRequests" }),
    "payment_requests",
  );
  assert.equal(
    classifyAssistantInstruction("Logo design project", {
      pending: "agenticPaymentRequests",
    }),
    "payment_requests",
  );
  assert.equal(
    classifyAssistantInstruction(
      "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",
      { pending: "agenticPayments" },
    ),
    "payments",
  );
});

test("a question or greeting during a clarification stays general", () => {
  assert.equal(
    classifyAssistantInstruction("What do you mean?", {
      pending: "agenticPaymentRequests",
    }),
    "general",
  );
  assert.equal(
    classifyAssistantInstruction("hello", { pending: "agenticPayments" }),
    "general",
  );
});

test("an explicit instruction outranks a pending clarification", () => {
  assert.equal(
    classifyAssistantInstruction("Create a payment request for 2 SOL", {
      pending: "agenticPayments",
    }),
    "payment_requests",
  );
});

test("routes map to capabilities deterministically", () => {
  assert.equal(assistantCapabilityForRoute("payments"), "agenticPayments");
  assert.equal(
    assistantCapabilityForRoute("payment_requests"),
    "agenticPaymentRequests",
  );
  assert.equal(assistantCapabilityForRoute("general"), null);
  assert.equal(assistantCapabilityForRoute("clarify"), null);

  assert.equal(isPaymentRoute("payments"), true);
  assert.equal(isPaymentRoute("payment_requests"), true);
  assert.equal(isPaymentRoute("clarify"), true);
  assert.equal(isPaymentRoute("general"), false);
});

test("only the two agentic capability hints are accepted from a client", () => {
  assert.equal(parsePendingCapability("agenticPayments"), "agenticPayments");
  assert.equal(
    parsePendingCapability("agenticPaymentRequests"),
    "agenticPaymentRequests",
  );
  assert.equal(parsePendingCapability("generalAssistance"), null);
  assert.equal(parsePendingCapability("admin"), null);
  assert.equal(parsePendingCapability(null), null);
});

test("the clarification copy asks for a direction and names no capability", () => {
  assert.match(AMBIGUOUS_PAYMENT_CLARIFICATION, /send/i);
  assert.match(AMBIGUOUS_PAYMENT_CLARIFICATION, /request/i);
});

// ---------------------------------------------------------------------------
// Capability status tags
// ---------------------------------------------------------------------------

test("loading shows three unknown tags and assumes nothing is enabled", () => {
  const state: AssistantCapabilityState = { status: "loading" };
  const tags = capabilityTagViews(state);

  assert.equal(tags.length, 3);
  assert.deepEqual(
    tags.map((tag) => tag.label),
    ["General Assistance", "Agentic Payments", "Agentic Payment Requests"],
  );
  assert.deepEqual(
    tags.map((tag) => tag.value),
    ["UNKNOWN", "UNKNOWN", "UNKNOWN"],
  );

  assert.equal(isCapabilityEnabled(state, "generalAssistance"), false);
  assert.equal(isCapabilityEnabled(state, "agenticPayments"), false);
});

test("an unavailable endpoint shows unknown tags and its message", () => {
  const state: AssistantCapabilityState = {
    status: "unavailable",
    message: ASSISTANT_CAPABILITIES_UNAVAILABLE_MESSAGE,
  };

  assert.deepEqual(
    capabilityTagViews(state).map((tag) => tag.value),
    ["UNKNOWN", "UNKNOWN", "UNKNOWN"],
  );
  assert.equal(isCapabilityEnabled(state, "agenticPaymentRequests"), false);
});

test("stored values render as ON and OFF per capability", () => {
  const state: AssistantCapabilityState = {
    status: "ready",
    capabilities: {
      generalAssistance: true,
      agenticPayments: false,
      agenticPaymentRequests: true,
    },
  };

  const tags = capabilityTagViews(state);

  assert.deepEqual(
    tags.map((tag) => tag.value),
    ["ON", "OFF", "ON"],
  );
  assert.deepEqual(
    tags.map((tag) => tag.tone),
    ["on", "off", "on"],
  );

  assert.equal(isCapabilityEnabled(state, "generalAssistance"), true);
  assert.equal(isCapabilityEnabled(state, "agenticPayments"), false);
});

test("the status loader reads the authenticated settings endpoint", async () => {
  const calls: Array<{ url: string; cache?: string }> = [];

  const ready = await fetchAssistantCapabilityState((async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    calls.push({
      url: String(input),
      cache: init?.cache,
    });

    return new Response(
      JSON.stringify({
        capabilities: {
          generalAssistance: true,
          agenticPayments: true,
          agenticPaymentRequests: false,
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch);

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, "/api/settings/ai-capabilities");
  assert.equal(calls[0]?.cache, "no-store");
  assert.equal(ready.signedOut, false);
  assert.deepEqual(
    capabilityTagViews(ready.state).map((tag) => tag.value),
    ["ON", "ON", "OFF"],
  );
});

test("the status loader reports 401, failures and malformed payloads as unavailable", async () => {
  const signedOut = await fetchAssistantCapabilityState((async () =>
    new Response(JSON.stringify({ error: "Authentication required." }), {
      status: 401,
    })) as typeof fetch);

  assert.equal(signedOut.signedOut, true);
  assert.equal(signedOut.state.status, "unavailable");
  assert.equal(
    signedOut.state.status === "unavailable" && signedOut.state.message,
    ASSISTANT_CAPABILITIES_SIGN_IN_MESSAGE,
  );

  const failed = await fetchAssistantCapabilityState((async () =>
    new Response(JSON.stringify({ error: "unavailable" }), {
      status: 503,
    })) as typeof fetch);

  assert.equal(failed.state.status, "unavailable");
  assert.equal(
    failed.state.status === "unavailable" && failed.state.message,
    ASSISTANT_CAPABILITIES_UNAVAILABLE_MESSAGE,
  );

  const malformed = await fetchAssistantCapabilityState((async () =>
    new Response(JSON.stringify({ capabilities: { generalAssistance: true } }), {
      status: 200,
    })) as typeof fetch);

  assert.equal(malformed.state.status, "unavailable");

  const threw = await fetchAssistantCapabilityState((async () => {
    throw new Error("network down");
  }) as typeof fetch);

  assert.equal(threw.state.status, "unavailable");
  assert.equal(threw.signedOut, false);
});

// ---------------------------------------------------------------------------
// Intent preview parsing
// ---------------------------------------------------------------------------

const READY_INTENT = {
  status: "ready",
  intentId: "AI-12345678",
  amountLamports: "100000000",
  amountSol: "0.1",
  recipientAddress: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",
  purpose: "design work",
  expiresAt: "2026-11-26T10:10:00.000Z",
  intentToken: "ppi1.c3VwZXItc2VjcmV0.c2ln",
};

test("a ready response becomes an outbound preview and drops the signed token", () => {
  const parsed = parseIntentPreparationResponse(READY_INTENT);

  assert.equal(parsed.kind, "intent");
  if (parsed.kind !== "intent") return;

  assert.equal(parsed.intent.intentId, "AI-12345678");
  assert.equal(parsed.intent.amountLamports, "100000000");
  assert.equal(parsed.intent.amountSol, "0.1");
  assert.equal(parsed.intent.purpose, "design work");
  assert.doesNotMatch(JSON.stringify(parsed), /c3VwZXItc2VjcmV0/);
  assert.doesNotMatch(JSON.stringify(parsed), /intentToken/);
});

test("the authorization token is read only by its dedicated in-memory reader", () => {
  assert.equal(
    readIntentAuthorizationToken(READY_INTENT),
    "ppi1.c3VwZXItc2VjcmV0.c2ln",
  );

  // Anything that is not a versioned intent token is refused.
  for (const payload of [
    { ...READY_INTENT, status: "clarification" },
    { ...READY_INTENT, intentToken: "intent.super-secret-token" },
    { ...READY_INTENT, intentToken: "" },
    { ...READY_INTENT, intentToken: 42 },
    { ...READY_INTENT, intentToken: `ppi1.${"a".repeat(5_000)}` },
    null,
    "ppi1.a.b",
  ]) {
    assert.equal(readIntentAuthorizationToken(payload), null);
  }
});

test("clarification, invalid and partial responses never produce a preview", () => {
  const clarification = parseIntentPreparationResponse({
    status: "clarification",
    missing: ["recipient"],
    message: "Who should receive it?",
  });

  assert.equal(clarification.kind, "clarification");
  if (clarification.kind === "clarification") {
    assert.deepEqual(clarification.missing, ["recipient"]);
  }

  const invalid = parseIntentPreparationResponse({
    status: "invalid",
    message: "The amount is not valid.",
  });

  assert.equal(invalid.kind, "notice");

  const partial = parseIntentPreparationResponse({
    status: "ready",
    amountSol: "0.1",
  });

  assert.equal(partial.kind, "malformed");

  const notReady = parseIntentPreparationResponse({ status: "ready", amountSol: "0.1", recipientAddress: "abc", expiresAt: "not-a-date" });
  assert.equal(notReady.kind, "malformed");
});

// ---------------------------------------------------------------------------
// UI wiring and isolation (source assertions)
// ---------------------------------------------------------------------------

function readSource(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("the assistant has no General/Payments mode selector", () => {
  const source = readSource("../src/app/ai-assistant/ai-assistant-client.tsx");

  assert.doesNotMatch(source, /setMode/);
  assert.doesNotMatch(source, /mode === ['"]payments['"]/);
  assert.doesNotMatch(source, /Switch to general assistant/);
  assert.doesNotMatch(source, /Switch to agentic payments/);
  assert.doesNotMatch(source, /'general' \| 'payments'/);
});

test("the assistant renders capability tags and pays one unified endpoint", () => {
  const source = readSource("../src/app/ai-assistant/ai-assistant-client.tsx");

  assert.match(source, /CapabilityStatusTags/);
  assert.match(source, /PaymentIntentCard/);
  assert.match(source, /\/api\/ai\/assistant/);
  assert.doesNotMatch(source, /\/api\/ai\/chat/);
  assert.doesNotMatch(source, /localStorage\.(getItem|setItem|removeItem)/);
  assert.doesNotMatch(source, /intentToken/);
  assert.doesNotMatch(source, /draftToken[^\n]*location|location[^\n]*draftToken/);
});

test("capability tags are informational: no fetch, no write, one Settings link", () => {
  const source = readSource("../src/components/ai-chat/capability-status-tags.tsx");

  assert.match(source, /AI_SETTINGS_HREF/);
  assert.match(source, /aria-busy/);
  assert.doesNotMatch(source, /fetch\(/);
  assert.doesNotMatch(source, /method:\s*["']PUT["']/);
});

test("the intent preview card is distinct and never receives a token", () => {
  const source = readSource("../src/components/ai-chat/payment-intent-card.tsx");

  assert.match(source, /PAYMENT_INTENT_CARD_HEADING/);
  assert.doesNotMatch(source, /intentToken/);
  assert.match(source, /Not sent/);
});

test("Settings can be opened directly on the AI section", () => {
  const source = readSource("../src/app/settings/settings-client.tsx");

  assert.match(source, /get\("section"\)/);
  assert.equal(AI_SETTINGS_HREF, "/settings?section=ai");
});

test("the customer checkout assistant stays public and capability-free", () => {
  for (const file of [
    "../src/app/api/pay/[reference]/assist/route.ts",
    "../src/components/checkout/chat-widget.tsx",
    "../src/components/checkout/use-chat.ts",
  ]) {
    const source = readSource(file);

    assert.doesNotMatch(source, /requireMerchant/);
    assert.doesNotMatch(source, /checkAiCapability|capability-guard/);
    assert.doesNotMatch(source, /assistant-routing/);
  }
});
