import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  loadIntentPreparation,
  mapAgentPaymentIntentPreparationRow,
  recordIntentPreparation,
  type IntentRegistryClient,
} from "../src/lib/ai/intent-registry.ts";

/**
 * Stage 4 Step 3: preparation persistence wrappers.
 *
 * The client is an in-memory fake; these tests prove validation, argument
 * shaping and outcome mapping, not Postgres behaviour. The real RPC is exercised
 * only by the excluded live concurrency suite.
 */

const NONCE = "ab".repeat(16);
const HASH = "a".repeat(64);
const CANONICAL = "b".repeat(64);
const BLOCKHASH = "11111111111111111111111111111111";
const WALLET = "So11111111111111111111111111111111111111112";
const NOW = new Date("2026-11-27T10:00:00.000Z");

function createClient(
  responses: {
    record?: { data: unknown; error?: { code?: string; message: string } | null };
    get?: { data: unknown; error?: { code?: string; message: string } | null };
    recordThrows?: boolean;
  } = {},
) {
  const calls = {
    record: [] as Record<string, unknown>[],
    get: [] as Record<string, unknown>[],
  };

  const client: IntentRegistryClient = {
    async insertIntent() {
      return { error: null };
    },
    async approveIntent() {
      return { data: null, error: null };
    },
    async reauthorizeIntent() {
      return { data: null, error: null };
    },
    async revokeIntent() {
      return { data: null, error: null };
    },
    async getIntent() {
      return { data: null, error: null };
    },
    async recordPreparation(input) {
      calls.record.push(input);

      if (responses.recordThrows) throw new Error("connection reset");

      return {
        data: responses.record?.data ?? { outcome: "recorded" },
        error: responses.record?.error ?? null,
      };
    },
    async getPreparation(input) {
      calls.get.push(input);
      return {
        data: responses.get?.data ?? null,
        error: responses.get?.error ?? null,
      };
    },
    async submitIntent() {
      return { data: null, error: null };
    },
    async verifyIntent() {
      return { data: null, error: null };
    },
    async failIntent() {
      return { data: null, error: null };
    },
  };

  return { client, calls };
}

function preparationRow(overrides: Record<string, unknown> = {}) {
  return {
    intent_id: "AI-12345678",
    intent_nonce: NONCE,
    merchant_wallet: WALLET,
    message_hash: HASH,
    canonical_fingerprint: CANONICAL,
    blockhash: BLOCKHASH,
    last_valid_block_height: 300_000_000,
    approval_expires_at: new Date(NOW.getTime() + 5 * 60 * 1000).toISOString(),
    created_at: NOW.toISOString(),
    ...overrides,
  };
}

test("recording a preparation sends the exact nonce, wallet, hashes and lifetime", async () => {
  const { client, calls } = createClient();

  const result = await recordIntentPreparation(
    {
      nonce: NONCE,
      merchantWallet: WALLET,
      messageHash: HASH,
      canonicalFingerprint: CANONICAL,
      blockhash: BLOCKHASH,
      lastValidBlockHeight: "300000000",
    },
    { client },
  );

  assert.equal(result.ok, true);
  assert.deepEqual(calls.record, [
    {
      nonce: NONCE,
      merchantWallet: WALLET,
      messageHash: HASH,
      canonicalFingerprint: CANONICAL,
      blockhash: BLOCKHASH,
      lastValidBlockHeight: "300000000",
    },
  ]);
});

test("invalid preparation inputs never reach the database client", async () => {
  const invalid: {
    nonce: string;
    merchantWallet: string;
    messageHash: string;
    canonicalFingerprint: string;
    blockhash: string;
    lastValidBlockHeight: string;
  }[] = [
    {
      nonce: "nope",
      merchantWallet: WALLET,
      messageHash: HASH,
      canonicalFingerprint: CANONICAL,
      blockhash: BLOCKHASH,
      lastValidBlockHeight: "1",
    },
    {
      nonce: NONCE,
      merchantWallet: WALLET,
      messageHash: "abc",
      canonicalFingerprint: CANONICAL,
      blockhash: BLOCKHASH,
      lastValidBlockHeight: "1",
    },
    {
      nonce: NONCE,
      merchantWallet: WALLET,
      messageHash: HASH,
      canonicalFingerprint: "xyz",
      blockhash: BLOCKHASH,
      lastValidBlockHeight: "1",
    },
    {
      nonce: NONCE,
      merchantWallet: WALLET,
      messageHash: HASH,
      canonicalFingerprint: CANONICAL,
      blockhash: "not-base58!",
      lastValidBlockHeight: "1",
    },
    {
      nonce: NONCE,
      merchantWallet: WALLET,
      messageHash: HASH,
      canonicalFingerprint: CANONICAL,
      blockhash: BLOCKHASH,
      lastValidBlockHeight: "0",
    },
    {
      nonce: NONCE,
      merchantWallet: "",
      messageHash: HASH,
      canonicalFingerprint: CANONICAL,
      blockhash: BLOCKHASH,
      lastValidBlockHeight: "1",
    },
  ];

  for (const input of invalid) {
    const { client, calls } = createClient();
    const result = await recordIntentPreparation(input, { client });

    assert.equal(result.ok, false);
    assert.equal(calls.record.length, 0);
  }
});

test("preparation outcomes map to stable registry results", async () => {
  const cases = [
    ["unknown", 0],
    ["wrong_merchant", 0],
    ["invalid_status", 0],
    ["approval_expired", 0],
    ["invalid_request", 0],
    ["something_else", 1],
  ] as const;

  for (const [outcome, expectUnavailable] of cases) {
    const { client } = createClient({
      record: { data: { outcome }, error: null },
    });

    const result = await recordIntentPreparation(
      {
        nonce: NONCE,
        merchantWallet: WALLET,
        messageHash: HASH,
        canonicalFingerprint: CANONICAL,
        blockhash: BLOCKHASH,
        lastValidBlockHeight: "300000000",
      },
      { client },
    );

    assert.equal(result.ok, false, outcome);

    if (expectUnavailable === 1) {
      assert.equal(result.code, "unavailable");
    } else {
      assert.equal(result.code, "rejected");
      assert.equal(result.outcome, outcome);
    }
  }
});

test("a database or transport failure is unavailable, not success", async () => {
  const broken = createClient({
    record: { data: null, error: { message: "db down" } },
  });
  const failed = await recordIntentPreparation(
    {
      nonce: NONCE,
      merchantWallet: WALLET,
      messageHash: HASH,
      canonicalFingerprint: CANONICAL,
      blockhash: BLOCKHASH,
      lastValidBlockHeight: "300000000",
    },
    { client: broken.client },
  );

  assert.equal(failed.ok, false);
  assert.equal(failed.code, "unavailable");

  const thrown = createClient({ recordThrows: true });
  const threw = await recordIntentPreparation(
    {
      nonce: NONCE,
      merchantWallet: WALLET,
      messageHash: HASH,
      canonicalFingerprint: CANONICAL,
      blockhash: BLOCKHASH,
      lastValidBlockHeight: "300000000",
    },
    { client: thrown.client },
  );

  assert.equal(threw.ok, false);
  assert.equal(threw.code, "unavailable");
});

test("a stored preparation is mapped with both hashes, lifetime and snapshot", async () => {
  const { client } = createClient({
    get: { data: preparationRow(), error: null },
  });

  const result = await loadIntentPreparation(
    { intentId: "AI-12345678", blockhash: BLOCKHASH },
    { client },
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.preparation.intentId, "AI-12345678");
  assert.equal(result.preparation.merchantWallet, WALLET);
  assert.equal(result.preparation.messageHash, HASH);
  assert.equal(result.preparation.canonicalFingerprint, CANONICAL);
  assert.equal(result.preparation.blockhash, BLOCKHASH);
  assert.equal(result.preparation.lastValidBlockHeight, "300000000");
  assert.equal(
    Date.parse(result.preparation.approvalExpiresAt),
    NOW.getTime() + 5 * 60 * 1000,
  );
});

test("the preparation is looked up by intent and blockhash, not by message hash", async () => {
  const { client, calls } = createClient({
    get: { data: preparationRow(), error: null },
  });

  await loadIntentPreparation(
    { intentId: "AI-12345678", blockhash: BLOCKHASH },
    { client },
  );

  assert.deepEqual(calls.get, [
    { intentId: "AI-12345678", blockhash: BLOCKHASH },
  ]);
});

function failureCode(
  result: Awaited<ReturnType<typeof loadIntentPreparation>>,
): string {
  assert.equal(result.ok, false);

  if (result.ok) throw new Error("unreachable");

  return result.code;
}

test("missing, malformed and foreign preparations are not found", async () => {
  const missing = createClient({ get: { data: null, error: null } });
  assert.equal(
    failureCode(
      await loadIntentPreparation(
        { intentId: "AI-12345678", blockhash: BLOCKHASH },
        { client: missing.client },
      ),
    ),
    "not_found",
  );

  const malformed = createClient({
    get: { data: preparationRow({ last_valid_block_height: 0 }), error: null },
  });
  assert.equal(
    failureCode(
      await loadIntentPreparation(
        { intentId: "AI-12345678", blockhash: BLOCKHASH },
        { client: malformed.client },
      ),
    ),
    "not_found",
  );

  // A row written before the canonical binding existed cannot bind anything.
  const legacyRow = createClient({
    get: { data: preparationRow({ canonical_fingerprint: null }), error: null },
  });
  assert.equal(
    failureCode(
      await loadIntentPreparation(
        { intentId: "AI-12345678", blockhash: BLOCKHASH },
        { client: legacyRow.client },
      ),
    ),
    "not_found",
  );

  const foreign = createClient({
    get: { data: preparationRow({ intent_id: "AI-87654321" }), error: null },
  });
  assert.equal(
    failureCode(
      await loadIntentPreparation(
        { intentId: "AI-12345678", blockhash: BLOCKHASH },
        { client: foreign.client },
      ),
    ),
    "not_found",
  );

  const otherBlockhash = createClient({
    get: {
      data: preparationRow({
        blockhash: "So11111111111111111111111111111111111111112",
      }),
      error: null,
    },
  });
  assert.equal(
    failureCode(
      await loadIntentPreparation(
        { intentId: "AI-12345678", blockhash: BLOCKHASH },
        { client: otherBlockhash.client },
      ),
    ),
    "not_found",
  );
});

test("a preparation lookup with bad input or a database error fails closed", async () => {
  const badBlockhash = createClient({
    get: { data: preparationRow(), error: null },
  });
  assert.equal(
    failureCode(
      await loadIntentPreparation(
        { intentId: "AI-12345678", blockhash: "not-base58!" },
        { client: badBlockhash.client },
      ),
    ),
    "invalid",
  );

  const dbError = createClient({
    get: { data: null, error: { message: "db down" } },
  });
  assert.equal(
    failureCode(
      await loadIntentPreparation(
        { intentId: "AI-12345678", blockhash: BLOCKHASH },
        { client: dbError.client },
      ),
    ),
    "unavailable",
  );
});

test("the preparation row mapper rejects malformed evidence", () => {
  assert.ok(mapAgentPaymentIntentPreparationRow(preparationRow()));

  for (const invalid of [
    preparationRow({ message_hash: "short" }),
    preparationRow({ canonical_fingerprint: "short" }),
    preparationRow({ canonical_fingerprint: null }),
    preparationRow({ blockhash: "x" }),
    preparationRow({ last_valid_block_height: -1 }),
    preparationRow({ approval_expires_at: "not-a-date" }),
    preparationRow({ intent_id: "" }),
    preparationRow({ merchant_wallet: "  " }),
    preparationRow({ intent_nonce: "ZZZ" }),
    null,
    "string",
  ]) {
    assert.equal(mapAgentPaymentIntentPreparationRow(invalid), null);
  }
});

test("block heights may arrive as numbers or numeric strings", () => {
  const numeric = mapAgentPaymentIntentPreparationRow(
    preparationRow({ last_valid_block_height: 123 }),
  );
  assert.equal(numeric?.lastValidBlockHeight, "123");

  const textual = mapAgentPaymentIntentPreparationRow(
    preparationRow({ last_valid_block_height: "456" }),
  );
  assert.equal(textual?.lastValidBlockHeight, "456");
});

test("the migrations are additive, denied to clients and service-role only", () => {
  const base = readFileSync(
    new URL(
      "../supabase/migrations/20261127120000_agent_payment_intent_preparations.sql",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(base, /CREATE TABLE IF NOT EXISTS public\.agent_payment_intent_preparations/);
  assert.match(base, /ENABLE ROW LEVEL SECURITY/);
  assert.match(base, /USING \(FALSE\)/);
  assert.match(base, /GRANT SELECT, INSERT ON TABLE public\.agent_payment_intent_preparations TO service_role/);
  assert.doesNotMatch(base, /GRANT\s+(?:ALL|UPDATE|DELETE)/i);
  assert.match(base, /SECURITY INVOKER/);
  assert.match(base, /FOR UPDATE/);
  assert.doesNotMatch(base, /DROP TABLE/i);

  // The additive canonical-fingerprint migration only adds a nullable column,
  // an index and a replaced RPC; it never widens access or deletes evidence.
  const canonical = readFileSync(
    new URL(
      "../supabase/migrations/20261127140000_agent_payment_intent_canonical_fingerprint.sql",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(canonical, /ADD COLUMN IF NOT EXISTS canonical_fingerprint TEXT/);
  assert.doesNotMatch(canonical, /canonical_fingerprint TEXT NOT NULL/);
  assert.match(canonical, /CREATE INDEX IF NOT EXISTS agent_intent_preparation_blockhash_idx/);
  assert.match(canonical, /GRANT EXECUTE ON FUNCTION/);
  assert.match(canonical, /TO service_role/);
  assert.doesNotMatch(canonical, /GRANT\s+(?:ALL|UPDATE|DELETE)/i);
  assert.doesNotMatch(canonical, /DROP TABLE|DELETE FROM|TRUNCATE/i);
  assert.doesNotMatch(canonical, /GRANT\s+[^;]*\bTO\s+(?:anon|authenticated)\b/i);
  assert.match(canonical, /ENABLE ROW LEVEL SECURITY|RLS and grants are unchanged/);
});
