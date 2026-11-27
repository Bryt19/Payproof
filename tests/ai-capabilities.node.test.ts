import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  AI_CAPABILITIES_INVALID_PATCH_MESSAGE,
  AI_CAPABILITIES_TABLE,
  DEFAULT_AI_CAPABILITIES,
  checkAiCapability,
  parseAiCapabilityPatch,
  readAiCapabilities,
  writeAiCapabilities,
} from "../src/lib/ai/capabilities.ts";
import {
  AI_CAPABILITIES_RATE_LIMIT_MESSAGE,
  MAX_AI_CAPABILITIES_BODY_BYTES,
  createAiCapabilitiesGetHandler,
  createAiCapabilitiesPutHandler,
} from "../src/app/api/settings/ai-capabilities/route.ts";
import type { RateLimitOutcome } from "../src/lib/auth/rate-limit.ts";

/**
 * Stage 0 capability store: persistence contract, validation, session scoping and
 * the read-only GET route. Every test uses a stub Supabase client or injected
 * dependencies, so no database, network or provider request is required.
 */

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SESSION_WALLET = "So11111111111111111111111111111111111111112";
const OTHER_MERCHANT_WALLET = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const NOW = new Date("2026-11-26T10:00:00.000Z");
const STORED_AT = "2026-11-20T09:00:00.000Z";

const ROUTE_URL = "http://localhost/api/settings/ai-capabilities";

type QueryCall = {
  table: string;
  method: "select" | "eq" | "maybeSingle" | "upsert";
  args: unknown[];
};

type StubOptions = {
  row?: Record<string, unknown> | null;
  readError?: { message: string } | null;
  writeError?: { message: string } | null;
  /** Accept the write but leave the stored row untouched. */
  ignoreWrites?: boolean;
};

/**
 * Minimal stand-in for the service-role client: it records every call so the
 * tests can assert the exact wallet each query is scoped to, and it keeps a
 * mutable row so a write followed by the module's re-read behaves like Supabase.
 */
function createStubDatabase(options: StubOptions = {}) {
  const calls: QueryCall[] = [];
  let row: Record<string, unknown> | null = options.row ?? null;

  const client = {
    from(table: string) {
      const query = {
        select(columns: string) {
          calls.push({ table, method: "select", args: [columns] });
          return query;
        },
        eq(column: string, value: string) {
          calls.push({ table, method: "eq", args: [column, value] });
          return query;
        },
        async maybeSingle() {
          calls.push({ table, method: "maybeSingle", args: [] });

          if (options.readError) {
            return { data: null, error: options.readError };
          }

          return { data: row ? { ...row } : null, error: null };
        },
        async upsert(
          values: Record<string, unknown>,
          config?: { onConflict?: string },
        ) {
          calls.push({ table, method: "upsert", args: [values, config] });

          if (options.writeError) {
            return { data: null, error: options.writeError };
          }

          if (!options.ignoreWrites) {
            row = { created_at: STORED_AT, ...(row ?? {}), ...values };
          }

          return { data: null, error: null };
        },
      };

      return query;
    },
  } as unknown as SupabaseClient;

  return { client, calls, getRow: () => row };
}

function storedRow(overrides: Record<string, unknown> = {}) {
  return {
    merchant_address: SESSION_WALLET,
    general_assistance: true,
    agentic_payments: false,
    agentic_payment_requests: false,
    updated_at: STORED_AT,
    ...overrides,
  };
}

function dependencies(client: SupabaseClient) {
  return { database: client, now: () => NOW };
}

function makeRequest(url: string = ROUTE_URL): NextRequest {
  return new NextRequest(url, { method: "GET" });
}

// ---------------------------------------------------------------------------
// 1. Defaults
// ---------------------------------------------------------------------------

test("the documented defaults are general on and both agentic capabilities off", () => {
  assert.deepEqual({ ...DEFAULT_AI_CAPABILITIES }, {
    generalAssistance: true,
    agenticPayments: false,
    agenticPaymentRequests: false,
  });
});

test("a missing database row returns the defaults and no updatedAt", async () => {
  const db = createStubDatabase();

  const result = await readAiCapabilities(SESSION_WALLET, dependencies(db.client));

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.deepEqual(result.capabilities, {
    generalAssistance: true,
    agenticPayments: false,
    agenticPaymentRequests: false,
  });
  assert.equal(result.updatedAt, null);
  assert.equal(result.source, "defaults");
});

// ---------------------------------------------------------------------------
// 2. Stored rows
// ---------------------------------------------------------------------------

test("an existing row returns its stored values and timestamp", async () => {
  const db = createStubDatabase({
    row: storedRow({
      general_assistance: false,
      agentic_payments: true,
      agentic_payment_requests: true,
    }),
  });

  const result = await readAiCapabilities(SESSION_WALLET, dependencies(db.client));

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.deepEqual(result.capabilities, {
    generalAssistance: false,
    agenticPayments: true,
    agenticPaymentRequests: true,
  });
  assert.equal(result.updatedAt, STORED_AT);
  assert.equal(result.source, "stored");
});

test("a row for a different merchant is never returned as this merchant's state", async () => {
  const db = createStubDatabase({
    row: storedRow({
      merchant_address: OTHER_MERCHANT_WALLET,
      general_assistance: true,
      agentic_payments: true,
      agentic_payment_requests: true,
    }),
  });

  const result = await readAiCapabilities(SESSION_WALLET, dependencies(db.client));

  assert.equal(result.ok, false);
});

// ---------------------------------------------------------------------------
// 3. Partial updates
// ---------------------------------------------------------------------------

test("a partial update writes only the supplied capability and preserves the rest", async () => {
  const db = createStubDatabase({
    row: storedRow({
      general_assistance: false,
      agentic_payments: false,
      agentic_payment_requests: true,
    }),
  });

  const result = await writeAiCapabilities(
    SESSION_WALLET,
    { agenticPayments: true },
    dependencies(db.client),
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;

  // Only the patched column plus the owner and timestamp were sent.
  const upserts = db.calls.filter((call) => call.method === "upsert");
  assert.equal(upserts.length, 1);
  assert.deepEqual(upserts[0].table, AI_CAPABILITIES_TABLE);
  assert.deepEqual(upserts[0].args[0], {
    merchant_address: SESSION_WALLET,
    updated_at: NOW.toISOString(),
    agentic_payments: true,
  });
  assert.deepEqual(upserts[0].args[1], { onConflict: "merchant_address" });

  // The two capabilities that were not supplied kept their stored values.
  assert.deepEqual(result.capabilities, {
    generalAssistance: false,
    agenticPayments: true,
    agenticPaymentRequests: true,
  });
  assert.equal(result.updatedAt, NOW.toISOString());
});

test("a first write supplies only the patched column so the schema defaults apply", async () => {
  const db = createStubDatabase({ row: null });

  const result = await writeAiCapabilities(
    SESSION_WALLET,
    { agenticPaymentRequests: true },
    dependencies(db.client),
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;

  const upsert = db.calls.find((call) => call.method === "upsert");
  assert.ok(upsert);
  assert.deepEqual(Object.keys(upsert.args[0] as object).sort(), [
    "agentic_payment_requests",
    "merchant_address",
    "updated_at",
  ]);

  // The stub applies the value; the module reports the re-read state.
  assert.equal(result.capabilities.agenticPaymentRequests, true);
});

test("the write re-reads state instead of returning assumed values", async () => {
  // Simulate a database that accepts the write but has not changed the row.
  const db = createStubDatabase({
    row: storedRow({ agentic_payments: false }),
    ignoreWrites: true,
  });

  const result = await writeAiCapabilities(
    SESSION_WALLET,
    { agenticPayments: true },
    dependencies(db.client),
  );

  // The reported state comes from the re-read, never from the submitted patch.
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.capabilities.agenticPayments, false);
});

// ---------------------------------------------------------------------------
// 4. Validation
// ---------------------------------------------------------------------------

test("unknown capability keys are rejected before any database call", async () => {
  const db = createStubDatabase({ row: storedRow() });

  for (const patch of [
    { admin: true },
    { agenticPayments: true, merchantAddress: true },
    { "agentic_payments": true },
    {},
    null,
    undefined,
    "agenticPayments",
    ["agenticPayments"],
  ]) {
    const parsed = parseAiCapabilityPatch(patch);
    assert.equal(parsed.ok, false);

    const result = await writeAiCapabilities(
      SESSION_WALLET,
      patch,
      dependencies(db.client),
    );

    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "invalid");
  }

  assert.equal(db.calls.filter((call) => call.method === "upsert").length, 0);
});

test("non-boolean values are rejected rather than coerced", async () => {
  const db = createStubDatabase({ row: storedRow() });

  for (const value of ["true", "false", 1, 0, null, undefined, {}, []]) {
    const parsed = parseAiCapabilityPatch({ agenticPayments: value });
    assert.equal(parsed.ok, false, `value ${JSON.stringify(value)} must be rejected`);

    const result = await writeAiCapabilities(
      SESSION_WALLET,
      { agenticPayments: value },
      dependencies(db.client),
    );

    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "invalid");
  }

  assert.equal(db.calls.filter((call) => call.method === "upsert").length, 0);
});

test("a valid patch keeps only known capabilities", () => {
  const parsed = parseAiCapabilityPatch({
    agenticPayments: true,
    generalAssistance: false,
  });

  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.deepEqual(parsed.patch, {
    agenticPayments: true,
    generalAssistance: false,
  });
});

test("the invalid-patch message does not echo submitted values or keys", () => {
  const parsed = parseAiCapabilityPatch({ "attacker-controlled-key": "secret-value" });
  assert.equal(parsed.ok, false);
  if (parsed.ok) return;

  assert.equal(parsed.message.includes("attacker-controlled-key"), false);
  assert.equal(parsed.message.includes("secret-value"), false);
  assert.equal(typeof AI_CAPABILITIES_INVALID_PATCH_MESSAGE, "string");
});

// ---------------------------------------------------------------------------
// 5. Fail-closed database behaviour
// ---------------------------------------------------------------------------

test("a database read failure returns unavailable, never defaults", async () => {
  const db = createStubDatabase({ readError: { message: "connection reset" } });

  const result = await readAiCapabilities(SESSION_WALLET, dependencies(db.client));

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "unavailable");
  assert.equal("capabilities" in result, false);
});

test("a thrown read exception returns unavailable", async () => {
  const client = {
    from() {
      throw new Error("boom");
    },
  } as unknown as SupabaseClient;

  const result = await readAiCapabilities(SESSION_WALLET, dependencies(client));

  assert.equal(result.ok, false);
});

test("a database write failure returns unavailable and never reports success", async () => {
  const db = createStubDatabase({
    row: storedRow(),
    writeError: { message: "permission denied" },
  });

  const result = await writeAiCapabilities(
    SESSION_WALLET,
    { agenticPayments: true },
    dependencies(db.client),
  );

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "unavailable");

  // The row was not modified, so nothing became enabled.
  assert.equal(db.getRow()?.agentic_payments, false);
});

test("an invalid merchant address is refused instead of defaulted", async () => {
  const db = createStubDatabase();

  for (const wallet of ["", "   ", "not-a-wallet", "abc123", `${SESSION_WALLET}!`]) {
    const result = await readAiCapabilities(wallet, dependencies(db.client));
    assert.equal(result.ok, false);
  }

  // The trimmed session wallet is the only accepted form.
  const trimmed = await readAiCapabilities(
    `  ${SESSION_WALLET}  `,
    dependencies(db.client),
  );
  assert.equal(trimmed.ok, true);
});

// ---------------------------------------------------------------------------
// 6. Capability checks
// ---------------------------------------------------------------------------

test("checkAiCapability follows stored state", async () => {
  const enabledDb = createStubDatabase({ row: storedRow({ agentic_payments: true }) });
  const disabledDb = createStubDatabase({ row: storedRow({ agentic_payments: false }) });

  const enabled = await checkAiCapability(
    SESSION_WALLET,
    "agenticPayments",
    dependencies(enabledDb.client),
  );
  assert.equal(enabled.ok, true);

  const disabled = await checkAiCapability(
    SESSION_WALLET,
    "agenticPayments",
    dependencies(disabledDb.client),
  );
  assert.equal(disabled.ok, false);
  if (!disabled.ok) assert.equal(disabled.reason, "disabled");
});

test("checkAiCapability fails closed on a missing row and on a read error", async () => {
  const defaultsDb = createStubDatabase({ row: null });

  const defaults = await checkAiCapability(
    SESSION_WALLET,
    "agenticPaymentRequests",
    dependencies(defaultsDb.client),
  );
  assert.equal(defaults.ok, false);
  if (!defaults.ok) assert.equal(defaults.reason, "disabled");

  const failingDb = createStubDatabase({ readError: { message: "timeout" } });

  const failing = await checkAiCapability(
    SESSION_WALLET,
    "agenticPayments",
    dependencies(failingDb.client),
  );
  assert.equal(failing.ok, false);
  if (!failing.ok) assert.equal(failing.reason, "unavailable");
});

// ---------------------------------------------------------------------------
// 7. Query scoping
// ---------------------------------------------------------------------------

test("every read query is scoped to the authenticated merchant wallet", async () => {
  const db = createStubDatabase({ row: storedRow() });

  await readAiCapabilities(SESSION_WALLET, dependencies(db.client));

  assert.deepEqual(
    db.calls.filter((call) => call.method === "select"),
    [
      {
        table: AI_CAPABILITIES_TABLE,
        method: "select",
        args: [
          "merchant_address, general_assistance, agentic_payments, agentic_payment_requests, updated_at",
        ],
      },
    ],
  );

  assert.deepEqual(
    db.calls.filter((call) => call.method === "eq"),
    [
      {
        table: AI_CAPABILITIES_TABLE,
        method: "eq",
        args: ["merchant_address", SESSION_WALLET],
      },
    ],
  );
});

test("the written row owner is the authenticated merchant wallet", async () => {
  const db = createStubDatabase({ row: storedRow() });

  await writeAiCapabilities(
    SESSION_WALLET,
    { generalAssistance: true },
    dependencies(db.client),
  );

  const upsert = db.calls.find((call) => call.method === "upsert");
  assert.ok(upsert);

  const values = upsert.args[0] as Record<string, unknown>;
  assert.equal(values.merchant_address, SESSION_WALLET);

  // The re-read after the write is scoped to the same wallet.
  const eqCalls = db.calls.filter((call) => call.method === "eq");
  assert.equal(eqCalls.length, 1);
  assert.deepEqual(eqCalls[0].args, ["merchant_address", SESSION_WALLET]);
});

// ---------------------------------------------------------------------------
// 8. GET route
// ---------------------------------------------------------------------------

function routeHandler(options: {
  merchant?: string | NextResponse | Error;
  read?: (merchantAddress: string) => Promise<
    Awaited<ReturnType<typeof readAiCapabilities>>
  >;
  seen?: string[];
}) {
  return createAiCapabilitiesGetHandler({
    resolveMerchant: async () => {
      if (options.merchant instanceof Error) throw options.merchant;
      return options.merchant ?? SESSION_WALLET;
    },
    readCapabilities: async (merchantAddress) => {
      options.seen?.push(merchantAddress);
      if (options.read) return options.read(merchantAddress);
      return {
        ok: true,
        capabilities: { ...DEFAULT_AI_CAPABILITIES },
        updatedAt: null,
        source: "defaults",
      };
    },
  });
}

test("a successful GET returns all three capabilities and no-store", async () => {
  const response = await routeHandler({})(makeRequest());

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");

  const body = (await response.json()) as {
    capabilities: Record<string, unknown>;
    updatedAt: unknown;
  };

  assert.deepEqual(Object.keys(body).sort(), ["capabilities", "updatedAt"]);
  assert.deepEqual(Object.keys(body.capabilities).sort(), [
    "agenticPaymentRequests",
    "agenticPayments",
    "generalAssistance",
  ]);
  assert.deepEqual(body.capabilities, {
    generalAssistance: true,
    agenticPayments: false,
    agenticPaymentRequests: false,
  });
  assert.equal(body.updatedAt, null);

  // Internal diagnostics are not exposed.
  assert.equal("source" in body, false);
});

test("GET returns an existing row's values and timestamp", async () => {
  const response = await routeHandler({
    read: async () => ({
      ok: true,
      capabilities: {
        generalAssistance: true,
        agenticPayments: true,
        agenticPaymentRequests: false,
      },
      updatedAt: STORED_AT,
      source: "stored",
    }),
  })(makeRequest());

  assert.equal(response.status, 200);

  const body = await response.json();
  assert.equal(body.capabilities.agenticPayments, true);
  assert.equal(body.updatedAt, STORED_AT);
});

test("unauthenticated requests return 401 before any capability read", async () => {
  const seen: string[] = [];

  const response = await routeHandler({
    merchant: NextResponse.json(
      { error: "Authentication required." },
      { status: 401 },
    ),
    seen,
  })(makeRequest());

  assert.equal(response.status, 401);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(seen.length, 0);

  const body = await response.json();
  assert.equal(body.error, "Authentication required.");
  assert.equal("capabilities" in body, false);
});

test("an authentication failure that throws returns 503 with no-store", async () => {
  const seen: string[] = [];

  const response = await routeHandler({
    merchant: new Error("auth store down"),
    seen,
  })(makeRequest());

  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(seen.length, 0);
});

test("a query-string or header wallet cannot override the session wallet", async () => {
  const seen: string[] = [];

  const response = await routeHandler({ seen })(
    makeRequest(
      `${ROUTE_URL}?walletAddress=${OTHER_MERCHANT_WALLET}&merchantAddress=${OTHER_MERCHANT_WALLET}`,
    ),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(seen, [SESSION_WALLET]);

  // The response carries only the session merchant's state.
  const body = await response.json();
  assert.equal(body.capabilities.agenticPayments, false);
});

test("a database read failure returns 503 and no capabilities", async () => {
  const db = createStubDatabase({ readError: { message: "connection reset" } });

  const response = await routeHandler({
    read: (merchantAddress) =>
      readAiCapabilities(merchantAddress, dependencies(db.client)),
  })(makeRequest());

  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store");

  const body = await response.json();
  assert.equal("capabilities" in body, false);
  assert.equal("updatedAt" in body, false);
  assert.equal(typeof body.error, "string");
});

test("the route exposes GET and PUT only", () => {
  const source = readFileSync(
    new URL("../src/app/api/settings/ai-capabilities/route.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /export const GET = createAiCapabilitiesGetHandler\(\)/);
  assert.match(source, /export const PUT = createAiCapabilitiesPutHandler\(\)/);

  // No DELETE (settings rows are retained) and no POST.
  assert.doesNotMatch(source, /export (async )?function POST/);
  assert.doesNotMatch(source, /export const POST/);
  assert.doesNotMatch(source, /export const DELETE|export (async )?function DELETE/);

  // The wallet is only ever taken from the session.
  assert.match(
    source,
    /resolveMerchant: \(request\) => requireMerchant\(request\)/,
  );
  assert.doesNotMatch(source, /searchParams/);
  assert.doesNotMatch(source, /headers\.get\(/);
  assert.match(source, /cache-control": "no-store"/);

  // The update reuses the shared rate-limit buckets rather than a new system.
  assert.match(source, /checkClientRateLimit\(\s*"ai-capabilities"/);
  assert.match(source, /checkWalletRateLimit\("ai-capabilities"/);
});

// ---------------------------------------------------------------------------
// 9. PUT route
// ---------------------------------------------------------------------------

function putRequest(
  body: unknown,
  options: { headers?: Record<string, string>; url?: string } = {},
): NextRequest {
  return new NextRequest(options.url ?? ROUTE_URL, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost",
      ...options.headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

/**
 * Builds the PUT handler with the real capability module wired to a stub client,
 * so the route-to-database contract is exercised end to end without Supabase.
 */
function createPutRoute(
  db: ReturnType<typeof createStubDatabase>,
  options: {
    merchant?: string | NextResponse | Error;
    limit?: RateLimitOutcome | Error;
    seen?: Array<{ wallet: string; patch: unknown }>;
  } = {},
) {
  return createAiCapabilitiesPutHandler({
    resolveMerchant: async () => {
      if (options.merchant instanceof Error) throw options.merchant;
      return options.merchant ?? SESSION_WALLET;
    },
    checkRateLimit: async () => {
      if (options.limit instanceof Error) throw options.limit;
      return options.limit ?? { ok: true };
    },
    writeCapabilities: async (wallet, patch) => {
      options.seen?.push({ wallet, patch });
      return writeAiCapabilities(wallet, patch, dependencies(db.client));
    },
  });
}

function upserts(db: ReturnType<typeof createStubDatabase>) {
  return db.calls.filter((call) => call.method === "upsert");
}

test("an authenticated PUT updates each capability independently", async () => {
  const cases = [
    { key: "generalAssistance", value: false, column: "general_assistance" },
    { key: "agenticPayments", value: true, column: "agentic_payments" },
    {
      key: "agenticPaymentRequests",
      value: true,
      column: "agentic_payment_requests",
    },
  ] as const;

  for (const testCase of cases) {
    const db = createStubDatabase({ row: storedRow() });

    const response = await createPutRoute(db)(
      putRequest({ capabilities: { [testCase.key]: testCase.value } }),
    );

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");

    const body = await response.json();
    assert.equal(body.capabilities[testCase.key], testCase.value);

    // Only the changed capability was written.
    const [upsert] = upserts(db);
    assert.ok(upsert);
    assert.deepEqual(
      Object.keys(upsert.args[0] as object).sort(),
      [testCase.column, "merchant_address", "updated_at"].sort(),
    );

    // The other two keep their stored values.
    for (const other of [
      "generalAssistance",
      "agenticPayments",
      "agenticPaymentRequests",
    ] as const) {
      if (other === testCase.key) continue;
      assert.equal(body.capabilities[other], DEFAULT_AI_CAPABILITIES[other]);
    }
  }
});

test("a partial update preserves the other two capabilities", async () => {
  const db = createStubDatabase({
    row: storedRow({
      general_assistance: false,
      agentic_payments: true,
      agentic_payment_requests: true,
    }),
  });

  const response = await createPutRoute(db)(
    putRequest({ capabilities: { agenticPaymentRequests: false } }),
  );

  assert.equal(response.status, 200);

  const body = await response.json();
  assert.deepEqual(body.capabilities, {
    generalAssistance: false,
    agenticPayments: true,
    agenticPaymentRequests: false,
  });

  const [upsert] = upserts(db);
  assert.ok(upsert);
  assert.deepEqual(
    Object.keys(upsert.args[0] as object).sort(),
    ["agentic_payment_requests", "merchant_address", "updated_at"].sort(),
  );
});

test("a PUT for a merchant with no row resolves to defaults plus the change", async () => {
  const db = createStubDatabase({ row: null });

  const response = await createPutRoute(db)(
    putRequest({ capabilities: { agenticPayments: true } }),
  );

  assert.equal(response.status, 200);

  const body = await response.json();
  assert.deepEqual(body.capabilities, {
    generalAssistance: true,
    agenticPayments: true,
    agenticPaymentRequests: false,
  });
  assert.equal(body.updatedAt, NOW.toISOString());
});

test("an unauthenticated PUT is rejected before any write", async () => {
  const db = createStubDatabase({ row: storedRow() });
  const seen: Array<{ wallet: string; patch: unknown }> = [];

  const response = await createPutRoute(db, {
    merchant: NextResponse.json(
      { error: "Authentication required." },
      { status: 401 },
    ),
    seen,
  })(putRequest({ capabilities: { agenticPayments: true } }));

  assert.equal(response.status, 401);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(seen.length, 0);
  assert.equal(upserts(db).length, 0);

  const body = await response.json();
  assert.equal(body.error, "Authentication required.");
  assert.equal("capabilities" in body, false);
});

test("a supplied wallet address cannot override the session wallet on PUT", async () => {
  const db = createStubDatabase({ row: storedRow() });
  const seen: Array<{ wallet: string; patch: unknown }> = [];

  const response = await createPutRoute(db, { seen })(
    putRequest(
      {
        capabilities: { agenticPayments: true },
        walletAddress: OTHER_MERCHANT_WALLET,
        merchantAddress: OTHER_MERCHANT_WALLET,
        merchant_wallet: OTHER_MERCHANT_WALLET,
      },
      {
        url: `${ROUTE_URL}?walletAddress=${OTHER_MERCHANT_WALLET}&merchantAddress=${OTHER_MERCHANT_WALLET}`,
        headers: {
          "x-wallet-address": OTHER_MERCHANT_WALLET,
          "x-merchant-wallet": OTHER_MERCHANT_WALLET,
        },
      },
    ),
  );

  assert.equal(response.status, 200);

  // The capability module only ever saw the session wallet and the capability
  // patch; the wallet-shaped fields were not read at all.
  assert.deepEqual(seen, [
    { wallet: SESSION_WALLET, patch: { agenticPayments: true } },
  ]);

  const [upsert] = upserts(db);
  assert.ok(upsert);
  assert.equal(
    (upsert.args[0] as Record<string, unknown>).merchant_address,
    SESSION_WALLET,
  );
});

test("unknown keys and non-boolean values are rejected without a write", async () => {
  const rejected = [
    { admin: true },
    { agenticPayments: "true" },
    { agenticPayments: "false" },
    { agenticPayments: 1 },
    { agenticPayments: 0 },
    { agenticPayments: null },
    { generalAssistance: true, agenticPayments: 0 },
  ];

  for (const capabilities of rejected) {
    const db = createStubDatabase({ row: storedRow() });

    const response = await createPutRoute(db)(putRequest({ capabilities }));

    assert.equal(response.status, 400);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(upserts(db).length, 0);

    const body = await response.json();
    assert.equal(typeof body.error, "string");
    assert.equal("capabilities" in body, false);
  }
});

test("empty and malformed bodies are rejected", async () => {
  const bodies: unknown[] = [
    {},
    { capabilities: {} },
    { capabilities: [] },
    { capabilities: "yes" },
    { capabilities: 42 },
    { capabilities: null },
    { agenticPayments: true },
    "not json",
    "[]",
    "null",
  ];

  for (const body of bodies) {
    const db = createStubDatabase({ row: storedRow() });

    const response = await createPutRoute(db)(putRequest(body));

    assert.equal(response.status, 400);
    assert.equal(upserts(db).length, 0);
  }
});

test("PUT enforces JSON, same-origin and body-size limits", async () => {
  const db = createStubDatabase({ row: storedRow() });

  const notJson = await createPutRoute(db)(
    putRequest(
      { capabilities: { agenticPayments: true } },
      { headers: { "content-type": "text/plain" } },
    ),
  );
  assert.equal(notJson.status, 415);

  const crossOrigin = await createPutRoute(db)(
    putRequest(
      { capabilities: { agenticPayments: true } },
      { headers: { origin: "https://evil.example" } },
    ),
  );
  assert.equal(crossOrigin.status, 403);

  const tooLarge = await createPutRoute(db)(
    putRequest({
      capabilities: { agenticPayments: true },
      padding: "a".repeat(MAX_AI_CAPABILITIES_BODY_BYTES + 64),
    }),
  );
  assert.equal(tooLarge.status, 413);

  assert.equal(upserts(db).length, 0);
});

test("a database write failure returns unavailable", async () => {
  const db = createStubDatabase({
    row: storedRow({ agentic_payments: false }),
    writeError: { message: "permission denied" },
  });

  const response = await createPutRoute(db)(
    putRequest({ capabilities: { agenticPayments: true } }),
  );

  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store");

  const body = await response.json();
  assert.equal("capabilities" in body, false);
  assert.equal(db.getRow()?.agentic_payments, false);
});

test("a failed re-read after the write never returns assumed values", async () => {
  const db = createStubDatabase({
    row: storedRow({ agentic_payments: false }),
    readError: { message: "replica unavailable" },
  });

  const response = await createPutRoute(db)(
    putRequest({ capabilities: { agenticPayments: true } }),
  );

  assert.equal(response.status, 503);

  const body = await response.json();
  assert.equal("capabilities" in body, false);
  assert.equal(JSON.stringify(body).includes("agenticPayments"), false);
});

test("a limited rate limit returns 429 with Retry-After and no write", async () => {
  const db = createStubDatabase({ row: storedRow() });
  const seen: Array<{ wallet: string; patch: unknown }> = [];

  const response = await createPutRoute(db, {
    seen,
    limit: { ok: false, kind: "limited", retryAfterSeconds: 45 },
  })(putRequest({ capabilities: { agenticPayments: true } }));

  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "45");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(seen.length, 0);
  assert.equal(upserts(db).length, 0);

  const body = await response.json();
  assert.equal(body.error, AI_CAPABILITIES_RATE_LIMIT_MESSAGE);
});

test("an unavailable rate-limit or auth store fails closed", async () => {
  const db = createStubDatabase({ row: storedRow() });
  const seen: Array<{ wallet: string; patch: unknown }> = [];

  const limited = await createPutRoute(db, {
    seen,
    limit: { ok: false, kind: "unavailable" },
  })(putRequest({ capabilities: { agenticPayments: true } }));
  assert.equal(limited.status, 503);

  const throwing = await createPutRoute(db, {
    seen,
    limit: new Error("rate limit store down"),
  })(putRequest({ capabilities: { agenticPayments: true } }));
  assert.equal(throwing.status, 503);

  const authThrew = await createPutRoute(db, {
    seen,
    merchant: new Error("auth store down"),
  })(putRequest({ capabilities: { agenticPayments: true } }));
  assert.equal(authThrew.status, 503);

  assert.equal(seen.length, 0);
  assert.equal(upserts(db).length, 0);
});

test("every PUT response includes no-store", async () => {
  const db = createStubDatabase({ row: storedRow() });

  const responses = [
    await createPutRoute(db)(
      putRequest({ capabilities: { agenticPayments: true } }),
    ),
    await createPutRoute(db)(putRequest({ capabilities: { admin: true } })),
    await createPutRoute(db, {
      merchant: NextResponse.json({ error: "Authentication required." }, { status: 401 }),
    })(putRequest({ capabilities: { agenticPayments: true } })),
    await createPutRoute(db)(
      putRequest(
        { capabilities: { agenticPayments: true } },
        { headers: { origin: "https://evil.example" } },
      ),
    ),
    await createPutRoute(db)(
      putRequest(
        { capabilities: { agenticPayments: true } },
        { headers: { "content-type": "text/plain" } },
      ),
    ),
    await createPutRoute(db, {
      limit: { ok: false, kind: "limited", retryAfterSeconds: 10 },
    })(putRequest({ capabilities: { agenticPayments: true } })),
    await createPutRoute(
      createStubDatabase({
        row: storedRow(),
        readError: { message: "unavailable" },
      }),
    )(putRequest({ capabilities: { agenticPayments: true } })),
  ];

  assert.deepEqual(
    responses.map((response) => response.status),
    [200, 400, 401, 403, 415, 429, 503],
  );

  for (const response of responses) {
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
});

// ---------------------------------------------------------------------------
// 10. Server-only boundary
// ---------------------------------------------------------------------------

test("the capability module is server-only and never imported by client code", () => {
  const moduleSource = readFileSync(
    new URL("../src/lib/ai/capabilities.ts", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(moduleSource, /"use client"/);
  assert.doesNotMatch(moduleSource, /from "react"/);

  for (const clientFile of [
    "../src/app/ai-assistant/ai-assistant-client.tsx",
    "../src/app/settings/settings-client.tsx",
    "../src/components/settings/settings-controls.tsx",
    "../src/components/checkout/chat-widget.tsx",
    "../src/components/checkout/use-chat.ts",
  ]) {
    const source = readFileSync(new URL(clientFile, import.meta.url), "utf8");
    assert.doesNotMatch(
      source,
      /lib\/ai\/capabilities/,
      `${clientFile} must not import the server-only capability module`,
    );
  }
});
