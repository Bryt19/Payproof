import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  AI_CAPABILITY_ITEMS,
  AI_CAPABILITY_KEYS,
  AI_CAPABILITIES_SAVE_FAILED_MESSAGE,
  beginToggle,
  confirmToggle,
  displayedValue,
  failToggle,
  isToggleDisabled,
  isTogglePending,
  parseCapabilityValues,
  type AiCapabilityPanelState,
  type AiCapabilityValues,
} from "../src/lib/settings/ai-capability-client.ts";

/**
 * Settings → AI capabilities: client model and isolation.
 *
 * The toggle state machine is pure, so the optimistic update, the rollback on a
 * failed save and the disabled-until-loaded rule are exercised directly — no DOM
 * harness, no network and no database.
 */

const VALUES: AiCapabilityValues = {
  generalAssistance: true,
  agenticPayments: false,
  agenticPaymentRequests: false,
};

const LOADING: AiCapabilityPanelState = { status: "loading" };
const UNAVAILABLE: AiCapabilityPanelState = {
  status: "unavailable",
  message: "AI settings unavailable",
};

function ready(
  overrides: Partial<AiCapabilityValues> = {},
): AiCapabilityPanelState {
  return {
    status: "ready",
    capabilities: { ...VALUES, ...overrides },
    pending: {},
    error: null,
  };
}

// ---------------------------------------------------------------------------
// 1. Copy and defaults
// ---------------------------------------------------------------------------

test("the three capability items carry the documented labels, copy and defaults", () => {
  assert.deepEqual(
    AI_CAPABILITY_ITEMS.map((item) => item.key),
    [...AI_CAPABILITY_KEYS],
  );

  // General Assistance defaults on; both agentic capabilities default off.
  assert.deepEqual(
    AI_CAPABILITY_ITEMS.map((item) => item.defaultValue),
    [true, false, false],
  );

  assert.equal(AI_CAPABILITY_ITEMS[0].label, "General Assistance");
  assert.match(
    AI_CAPABILITY_ITEMS[0].description,
    /answer general questions and provide business and payment guidance/,
  );

  assert.equal(AI_CAPABILITY_ITEMS[1].label, "Agentic Payments");
  assert.match(
    AI_CAPABILITY_ITEMS[1].description,
    /merchant-initiated SOL payment intents/,
  );

  assert.equal(AI_CAPABILITY_ITEMS[2].label, "Agentic Payment Requests");
  assert.match(
    AI_CAPABILITY_ITEMS[2].description,
    /incoming payment requests for customers/,
  );
});

// ---------------------------------------------------------------------------
// 2. Response parsing
// ---------------------------------------------------------------------------

test("a complete capability payload is accepted", () => {
  assert.deepEqual(
    parseCapabilityValues({ capabilities: VALUES, updatedAt: null }),
    VALUES,
  );

  assert.deepEqual(
    parseCapabilityValues({
      capabilities: {
        generalAssistance: false,
        agenticPayments: true,
        agenticPaymentRequests: true,
      },
      updatedAt: "2026-11-26T10:00:00.000Z",
    }),
    {
      generalAssistance: false,
      agenticPayments: true,
      agenticPaymentRequests: true,
    },
  );
});

test("an incomplete or malformed payload is rejected instead of defaulted", () => {
  const invalid: unknown[] = [
    null,
    undefined,
    "nope",
    [],
    {},
    { capabilities: null },
    { capabilities: [] },
    { capabilities: { generalAssistance: true } },
    { capabilities: { ...VALUES, agenticPayments: "false" } },
    { capabilities: { ...VALUES, agenticPaymentRequests: 0 } },
  ];

  for (const payload of invalid) {
    assert.equal(parseCapabilityValues(payload), null);
  }
});

// ---------------------------------------------------------------------------
// 3. Toggles stay disabled until the server confirms state
// ---------------------------------------------------------------------------

test("toggles are disabled and display nothing while loading", () => {
  for (const key of AI_CAPABILITY_KEYS) {
    assert.equal(isToggleDisabled(LOADING, key), true);
    assert.equal(isTogglePending(LOADING, key), false);
    assert.equal(displayedValue(LOADING, key), null);
  }
});

test("toggles are disabled and display nothing when the load failed", () => {
  // The initial settings request failed: the UI must not offer a default-looking
  // switch, so every toggle is disabled and no value is invented.
  for (const key of AI_CAPABILITY_KEYS) {
    assert.equal(isToggleDisabled(UNAVAILABLE, key), true);
    assert.equal(displayedValue(UNAVAILABLE, key), null);
  }
});

test("toggles are enabled and show server values once loaded", () => {
  const state = ready();

  for (const key of AI_CAPABILITY_KEYS) {
    assert.equal(isToggleDisabled(state, key), false);
    assert.equal(displayedValue(state, key), VALUES[key]);
  }
});

// ---------------------------------------------------------------------------
// 4. Optimistic update, confirmation and rollback
// ---------------------------------------------------------------------------

test("a change shows a pending state for that toggle only", () => {
  const started = beginToggle(ready(), "agenticPayments");

  assert.equal(started.status, "ready");
  if (started.status !== "ready") return;

  // Optimistic value is shown, the confirmed value is untouched.
  assert.equal(displayedValue(started, "agenticPayments"), true);
  assert.equal(started.capabilities.agenticPayments, false);
  assert.equal(isTogglePending(started, "agenticPayments"), true);

  // The same toggle cannot be changed again while it is in flight...
  assert.equal(isToggleDisabled(started, "agenticPayments"), true);

  // ...while the other two stay independently usable.
  assert.equal(isToggleDisabled(started, "generalAssistance"), false);
  assert.equal(isToggleDisabled(started, "agenticPaymentRequests"), false);
});

test("a second change to the same toggle is ignored while its request is pending", () => {
  const started = beginToggle(ready(), "generalAssistance");
  const again = beginToggle(started, "generalAssistance");

  assert.equal(again, started);
});

test("the server-confirmed values replace the optimistic ones", () => {
  const started = beginToggle(ready(), "agenticPayments");
  const confirmed = confirmToggle(started, "agenticPayments", {
    generalAssistance: true,
    agenticPayments: true,
    agenticPaymentRequests: false,
  });

  assert.equal(confirmed.status, "ready");
  if (confirmed.status !== "ready") return;

  assert.equal(confirmed.capabilities.agenticPayments, true);
  assert.equal(isTogglePending(confirmed, "agenticPayments"), false);
  assert.equal(displayedValue(confirmed, "agenticPayments"), true);
  assert.equal(confirmed.error, null);
});

test("a failed update restores the previous toggle state and reports the error", () => {
  const before = ready();
  const started = beginToggle(before, "agenticPayments");

  assert.equal(displayedValue(started, "agenticPayments"), true);

  const failed = failToggle(
    started,
    "agenticPayments",
    AI_CAPABILITIES_SAVE_FAILED_MESSAGE,
  );

  assert.equal(failed.status, "ready");
  if (failed.status !== "ready") return;

  // Back to the previously confirmed value, not the optimistic one.
  assert.equal(displayedValue(failed, "agenticPayments"), false);
  assert.equal(failed.capabilities.agenticPayments, false);
  assert.equal(isTogglePending(failed, "agenticPayments"), false);
  assert.equal(failed.error, AI_CAPABILITIES_SAVE_FAILED_MESSAGE);

  // The switch is usable again after the rollback.
  assert.equal(isToggleDisabled(failed, "agenticPayments"), false);
});

test("one toggle failing does not disturb another toggle in flight", () => {
  const bothPending = beginToggle(
    beginToggle(ready(), "generalAssistance"),
    "agenticPayments",
  );

  const failed = failToggle(bothPending, "generalAssistance", "save failed");

  assert.equal(failed.status, "ready");
  if (failed.status !== "ready") return;

  assert.equal(displayedValue(failed, "generalAssistance"), true);
  assert.equal(isTogglePending(failed, "generalAssistance"), false);

  // The other update keeps its optimistic value and stays pending.
  assert.equal(displayedValue(failed, "agenticPayments"), true);
  assert.equal(isTogglePending(failed, "agenticPayments"), true);
});

// ---------------------------------------------------------------------------
// 5. Isolation
// ---------------------------------------------------------------------------

function readSource(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("the settings section reads from the API and never from local storage", () => {
  const component = readSource("../src/components/settings/ai-capabilities.tsx");

  assert.match(component, /\/api\/settings\/ai-capabilities/);
  assert.match(component, /method: "PUT"/);
  assert.match(component, /@\/lib\/settings\/ai-capability-client/);

  // No server-only module, no local storage, no service-role access.
  assert.doesNotMatch(component, /lib\/ai\/capabilities/);
  assert.doesNotMatch(component, /localStorage|sessionStorage/);
  assert.doesNotMatch(component, /SERVICE_ROLE|service_role/);
});

test("the client module imports nothing server-side", () => {
  const moduleSource = readSource(
    "../src/lib/settings/ai-capability-client.ts",
  );

  // Import-shaped checks, so documentation that names the forbidden module does
  // not trip the assertion.
  assert.doesNotMatch(moduleSource, /from\s+["'][^"']*lib\/ai\/capabilities["']/);
  assert.doesNotMatch(moduleSource, /from\s+["'][^"']*supabase[^"']*["']/i);
  assert.doesNotMatch(moduleSource, /from\s+["']@\/lib\/auth/);
  assert.doesNotMatch(moduleSource, /localStorage/);
  assert.doesNotMatch(moduleSource, /"use client"/);
});

test("the AI section is wired into Settings without local storage", () => {
  const settings = readSource("../src/app/settings/settings-client.tsx");

  assert.match(settings, /ai: "AI capabilities"/);
  assert.match(settings, /<AiCapabilitiesSection \/>/);

  // The section is part of the navigation list. `\s*` tolerates CRLF files.
  assert.match(settings, /\n\s*"ai",/);
});

test("the customer checkout assistant stays isolated from merchant capabilities", () => {
  const files = [
    "../src/app/api/pay/[reference]/assist/route.ts",
    "../src/lib/ai/customer-assist-handler.ts",
    "../src/lib/ai/customer-assist-context.ts",
    "../src/components/checkout/chat-widget.tsx",
    "../src/components/checkout/use-chat.ts",
  ];

  for (const file of files) {
    const source = readSource(file);

    assert.doesNotMatch(source, /capabilit/i, `${file} must not use capabilities`);
    assert.doesNotMatch(source, /\/api\/settings/, `${file} must not call settings`);
    assert.doesNotMatch(source, /merchant_ai/, `${file} must not read merchant AI rows`);
  }

  // The checkout route is still a POST-only, read-only assist endpoint.
  const assistRoute = readSource(
    "../src/app/api/pay/[reference]/assist/route.ts",
  );
  assert.match(assistRoute, /export const POST/);
  assert.doesNotMatch(assistRoute, /export const (GET|PUT|DELETE)/);
});
