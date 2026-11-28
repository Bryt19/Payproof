import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  createIntentToken,
  generateIntentNonce,
  INTENT_TOKEN_PREFIX,
  INTENT_TOKEN_TTL_SECONDS,
  intentAuthorizationExpiry,
  intentAuthorizationFingerprint,
  MAX_INTENT_TOKEN_LENGTH,
  MIN_INTENT_TOKEN_SECRET_LENGTH,
  resolveIntentTokenSecret,
  verifyIntentToken,
} from "../src/lib/ai/intent-token.ts";
import {
  AGENT_INTENT_FAILURE_REASONS,
  approveIntentAuthorization,
  createAuthorizedIntent,
  failIntentTransaction,
  generateIntentId,
  loadIntentForMerchant,
  mapAgentPaymentIntentRow,
  reauthorizeIntentAuthorization,
  registerIntentAuthorization,
  revokeIntentAuthorization,
  submitIntentTransaction,
  verifyIntentTransaction,
  type AgentPaymentIntentRow,
  type AgentPaymentIntentStatus,
  type IntentRegistryClient,
} from "../src/lib/ai/intent-registry.ts";
import type { PaymentIntent } from "../src/lib/ai/payment-intent.ts";

/**
 * Stage 2 coverage: token cryptography, registry state transitions and the
 * migration's structural guarantees.
 *
 * IMPORTANT: no database runs in this suite. The RPC behaviour is simulated by
 * an in-memory client that mirrors the SQL state machine and holds a
 * promise-chain mutex where the migration uses `SELECT ... FOR UPDATE`. Actual
 * Postgres locking, RLS and grants are asserted structurally against the
 * migration file; they are not executed here.
 */

const MERCHANT = "So11111111111111111111111111111111111111112";
const OTHER_MERCHANT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const RECIPIENT = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const RECIPIENT_TWO = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const REFERENCE = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";

const SECRET = "stage-2-intent-token-secret-0123456789";
const NONCE = "a".repeat(32);
const NOW = new Date("2026-11-24T10:00:00.000Z");

const INTENT: PaymentIntent = {
  amountLamports: "2000000000",
  amountSol: "2",
  recipientAddress: RECIPIENT,
  purpose: "website development deposit",
  currency: "SOL",
  sourceKind: "address",
  sourcePaymentRequestReference: null,
};

function intentWith(overrides: Partial<PaymentIntent> = {}): PaymentIntent {
  return { ...INTENT, ...overrides };
}

const EXPIRES_AT = new Date(NOW.getTime() + 5 * 60 * 1000).toISOString();
const APPROVAL_WINDOW_MS = 5 * 60 * 1000;

// Base58 strings that decode to exactly 64 bytes, so `isSignature` accepts them.
const SIGNATURE = "1".repeat(64);
const SIGNATURE_TWO = `${"1".repeat(63)}2`;
const SIGNATURE_THREE = `${"1".repeat(63)}3`;
/** Any base64 payload satisfies the registry shape check; the fake client stores it verbatim. */
const TRANSACTION_BASE64 = "AQIDBAUGBwg=";

// ---------------------------------------------------------------------------
// In-memory registry (simulates the SQL RPCs; not a database)
// ---------------------------------------------------------------------------

type FakeRow = Omit<AgentPaymentIntentRow, "status"> & {
  status: AgentPaymentIntentStatus;
  transaction_signature: string | null;
  payer_address: string | null;
  verified_at: string | null;
  created_at: string;
  approved_at: string | null;
  approval_expires_at: string | null;
  submitted_at: string | null;
  failure_reason: string | null;
};

function createInMemoryRegistry({ now }: { now: () => number }) {
  const rows = new Map<string, FakeRow>();
  const preparations: Record<string, unknown>[] = [];
  const counters = {
    inserts: 0,
    approves: 0,
    reauthorizes: 0,
    revokes: 0,
    loads: 0,
    submits: 0,
    verifies: 0,
    fails: 0,
  };
  let tail: Promise<unknown> = Promise.resolve();

  function locked<T>(fn: () => T): Promise<T> {
    const run = tail.then(fn, fn);
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  function serialise(row: FakeRow): Record<string, unknown> {
    return { ...row };
  }

  function find(nonce: string): FakeRow | undefined {
    return rows.get(nonce);
  }

  const client: IntentRegistryClient = {
    async insertIntent(row) {
      counters.inserts += 1;

      for (const existing of rows.values()) {
        if (
          existing.nonce === row.nonce ||
          existing.reference === row.reference ||
          existing.id === row.id
        ) {
          return {
            error: {
              code: "23505",
              message: "duplicate key value violates unique constraint",
            },
          };
        }
      }

      const stored: FakeRow = {
        ...row,
        transaction_signature: null,
        payer_address: null,
        verified_at: null,
        created_at: new Date(now()).toISOString(),
        approved_at: null,
        approval_expires_at: null,
        submitted_at: null,
        failure_reason: null,
      };

      rows.set(row.nonce, stored);
      return { data: serialise(stored), error: null };
    },

    async approveIntent({ nonce, merchantWallet, fingerprint }) {
      counters.approves += 1;

      return locked(() => {
        const row = find(nonce);
        if (!row) return { data: { outcome: "unknown" }, error: null };
        if (row.merchant_wallet !== merchantWallet) {
          return { data: { outcome: "wrong_merchant" }, error: null };
        }
        if (row.intent_fingerprint !== fingerprint) {
          return { data: { outcome: "fingerprint_mismatch" }, error: null };
        }
        if (
          row.status === "approved" ||
          row.status === "submitted" ||
          row.status === "verified"
        ) {
          if (
            row.status === "approved" &&
            (row.approval_expires_at === null ||
              Date.parse(row.approval_expires_at) <= now())
          ) {
            row.approved_at = row.approved_at ?? new Date(now()).toISOString();
            row.approval_expires_at = new Date(
              now() + APPROVAL_WINDOW_MS,
            ).toISOString();

            return {
              data: { outcome: "approved", intent: serialise(row) },
              error: null,
            };
          }

          return {
            data: { outcome: "already_approved", intent: serialise(row) },
            error: null,
          };
        }
        if (row.status === "cancelled") {
          return { data: { outcome: "revoked" }, error: null };
        }
        if (row.status === "expired") {
          return { data: { outcome: "expired" }, error: null };
        }
        if (row.status !== "draft") {
          return {
            data: { outcome: "invalid_status", status: row.status },
            error: null,
          };
        }
        if (Date.parse(row.expires_at) <= now()) {
          row.status = "expired";
          return { data: { outcome: "expired" }, error: null };
        }

        row.status = "approved";
        row.approved_at = new Date(now()).toISOString();
        row.approval_expires_at = new Date(
          now() + APPROVAL_WINDOW_MS,
        ).toISOString();

        return {
          data: { outcome: "approved", intent: serialise(row) },
          error: null,
        };
      });
    },

    async reauthorizeIntent(input) {
      counters.reauthorizes += 1;

      return locked(() => {
        const row = find(input.nonce);
        if (!row) return { data: { outcome: "unknown" }, error: null };
        if (row.merchant_wallet !== input.merchantWallet) {
          return { data: { outcome: "wrong_merchant" }, error: null };
        }
        if (
          row.status === "approved" ||
          row.status === "submitted" ||
          row.status === "verified"
        ) {
          return { data: { outcome: "approved" }, error: null };
        }
        if (row.status === "cancelled") {
          return { data: { outcome: "revoked" }, error: null };
        }
        if (row.status === "expired") {
          return { data: { outcome: "expired" }, error: null };
        }
        if (row.status !== "draft") {
          return {
            data: { outcome: "invalid_status", status: row.status },
            error: null,
          };
        }
        if (Date.parse(row.expires_at) <= now()) {
          row.status = "expired";
          return { data: { outcome: "expired" }, error: null };
        }
        if (rows.has(input.newNonce)) {
          return {
            data: null,
            error: { code: "23505", message: "duplicate nonce" },
          };
        }

        rows.delete(input.nonce);
        row.nonce = input.newNonce;
        row.intent_fingerprint = input.newFingerprint;
        row.expires_at = input.newExpiresAt;
        row.recipient_address = input.recipientAddress;
        row.amount_lamports = input.amountLamports;
        row.purpose = input.purpose;
        row.source_kind = input.sourceKind;
        row.source_payment_request_reference =
          input.sourcePaymentRequestReference;
        rows.set(row.nonce, row);

        return {
          data: { outcome: "reauthorized", intent: serialise(row) },
          error: null,
        };
      });
    },

    async revokeIntent({ nonce, merchantWallet }) {
      counters.revokes += 1;

      return locked(() => {
        const row = find(nonce);
        if (!row) return { data: { outcome: "unknown" }, error: null };
        if (row.merchant_wallet !== merchantWallet) {
          return { data: { outcome: "wrong_merchant" }, error: null };
        }
        if (row.status === "submitted" || row.status === "verified") {
          return { data: { outcome: "approved" }, error: null };
        }
        if (row.status === "cancelled") {
          return { data: { outcome: "revoked" }, error: null };
        }
        if (row.status === "expired") {
          return { data: { outcome: "expired" }, error: null };
        }
        if (row.status !== "draft" && row.status !== "approved") {
          return {
            data: { outcome: "invalid_status", status: row.status },
            error: null,
          };
        }
        if (row.status === "draft" && Date.parse(row.expires_at) <= now()) {
          row.status = "expired";
          return { data: { outcome: "expired" }, error: null };
        }

        row.status = "cancelled";
        return { data: { outcome: "revoked" }, error: null };
      });
    },

    async getIntent({ merchantWallet, nonce, id }) {
      counters.loads += 1;

      for (const row of rows.values()) {
        const matchesNonce = nonce !== undefined && row.nonce === nonce;
        const matchesId = nonce === undefined && row.id === id;

        if (!matchesNonce && !matchesId) continue;
        if (row.merchant_wallet !== merchantWallet) {
          return { data: null, error: null };
        }

        return { data: serialise(row), error: null };
      }

      return { data: null, error: null };
    },

    async recordPreparation({
      nonce,
      merchantWallet,
      messageHash,
      canonicalFingerprint,
      blockhash,
      lastValidBlockHeight,
    }) {
      return locked(() => {
        const row = find(nonce);

        if (!row) return { data: { outcome: "unknown" }, error: null };
        if (row.merchant_wallet !== merchantWallet) {
          return { data: { outcome: "wrong_merchant" }, error: null };
        }
        if (row.status !== "approved") {
          return { data: { outcome: "invalid_status" }, error: null };
        }
        if (
          !row.approval_expires_at ||
          Date.parse(row.approval_expires_at) <= now()
        ) {
          return { data: { outcome: "approval_expired" }, error: null };
        }

        const exists = preparations.some(
          (preparation) =>
            preparation.intent_id === row.id &&
            preparation.message_hash === messageHash,
        );

        if (!exists) {
          preparations.push({
            intent_id: row.id,
            intent_nonce: row.nonce,
            merchant_wallet: merchantWallet,
            message_hash: messageHash,
            canonical_fingerprint: canonicalFingerprint,
            blockhash,
            last_valid_block_height: Number(lastValidBlockHeight),
            approval_expires_at: row.approval_expires_at,
            created_at: new Date(now()).toISOString(),
          });
        }

        return { data: { outcome: "recorded" }, error: null };
      });
    },

    async getPreparation({ intentId, blockhash }) {
      const found = preparations
        .filter(
          (preparation) =>
            preparation.intent_id === intentId &&
            preparation.blockhash === blockhash,
        )
        .sort((left, right) =>
          String(right.created_at).localeCompare(String(left.created_at)),
        )[0];

      return { data: found ? { ...found } : null, error: null };
    },

    async submitIntent({ nonce, merchantWallet, signature, payerAddress }) {
      counters.submits += 1;

      return locked(() => {
        const row = find(nonce);
        if (!row) return { data: { outcome: "unknown" }, error: null };
        if (row.merchant_wallet !== merchantWallet) {
          return { data: { outcome: "wrong_merchant" }, error: null };
        }
        if (row.status === "submitted") {
          if (row.transaction_signature === signature) {
            return {
              data: { outcome: "already_submitted", intent: serialise(row) },
              error: null,
            };
          }

          return { data: { outcome: "signature_conflict" }, error: null };
        }
        if (row.status === "verified") {
          return { data: { outcome: "already_verified" }, error: null };
        }
        if (row.status === "cancelled" || row.status === "expired") {
          return {
            data: { outcome: "invalid_status", status: row.status },
            error: null,
          };
        }
        if (row.status !== "approved") {
          return { data: { outcome: "not_approved" }, error: null };
        }
        if (
          row.approval_expires_at === null ||
          Date.parse(row.approval_expires_at) <= now()
        ) {
          return { data: { outcome: "approval_expired" }, error: null };
        }

        for (const other of rows.values()) {
          if (other.nonce !== nonce && other.transaction_signature === signature) {
            return { data: { outcome: "signature_conflict" }, error: null };
          }
        }

        row.status = "submitted";
        row.transaction_signature = signature;
        row.payer_address = payerAddress;
        row.submitted_at = new Date(now()).toISOString();

        return {
          data: { outcome: "submitted", intent: serialise(row) },
          error: null,
        };
      });
    },

    async verifyIntent({ nonce, merchantWallet, signature, payerAddress }) {
      counters.verifies += 1;

      return locked(() => {
        const row = find(nonce);
        if (!row) return { data: { outcome: "unknown" }, error: null };
        if (row.merchant_wallet !== merchantWallet) {
          return { data: { outcome: "wrong_merchant" }, error: null };
        }
        if (row.status === "verified") {
          if (
            row.transaction_signature === signature &&
            row.payer_address === payerAddress
          ) {
            return {
              data: { outcome: "already_verified", intent: serialise(row) },
              error: null,
            };
          }

          return { data: { outcome: "signature_conflict" }, error: null };
        }
        if (row.status !== "submitted") {
          return { data: { outcome: "not_submitted" }, error: null };
        }
        if (row.transaction_signature !== signature) {
          return { data: { outcome: "signature_mismatch" }, error: null };
        }
        if (row.payer_address !== payerAddress) {
          return { data: { outcome: "payer_mismatch" }, error: null };
        }

        row.status = "verified";
        row.verified_at = new Date(now()).toISOString();
        row.failure_reason = null;

        return {
          data: { outcome: "verified", intent: serialise(row) },
          error: null,
        };
      });
    },

    async failIntent({ nonce, merchantWallet, signature, reason }) {
      counters.fails += 1;

      return locked(() => {
        const row = find(nonce);
        if (!row) return { data: { outcome: "unknown" }, error: null };
        if (row.merchant_wallet !== merchantWallet) {
          return { data: { outcome: "wrong_merchant" }, error: null };
        }
        if (row.status === "verified") {
          return { data: { outcome: "already_verified" }, error: null };
        }
        if (row.status === "failed") {
          if (row.transaction_signature === signature) {
            return {
              data: { outcome: "already_failed", intent: serialise(row) },
              error: null,
            };
          }

          return { data: { outcome: "signature_mismatch" }, error: null };
        }
        if (row.status !== "submitted") {
          return { data: { outcome: "not_submitted" }, error: null };
        }
        if (row.transaction_signature !== signature) {
          return { data: { outcome: "signature_mismatch" }, error: null };
        }

        row.status = "failed";
        row.failure_reason = reason;

        return {
          data: { outcome: "failed", intent: serialise(row) },
          error: null,
        };
      });
    },
  };

  return { client, rows, counters };
}

async function registerFixture(
  registry: ReturnType<typeof createInMemoryRegistry>,
  overrides: {
    intent?: PaymentIntent;
    nonce?: string;
    reference?: string;
    expiresAt?: string;
  } = {},
) {
  return registerIntentAuthorization(
    {
      nonce: overrides.nonce ?? NONCE,
      merchantWallet: MERCHANT,
      intent: overrides.intent ?? INTENT,
      reference: overrides.reference,
      expiresAt: overrides.expiresAt ?? EXPIRES_AT,
      now: NOW,
    },
    { client: registry.client },
  );
}

type FakeRegistry = ReturnType<typeof createInMemoryRegistry>;

/**
 * Approves the default intent, registering it first when it does not exist yet.
 * Returns the identity needed for later approvals.
 */
async function approvedFixture(
  registry: FakeRegistry,
): Promise<{ intentId: string; fingerprint: string }> {
  const existing = registry.rows.get(NONCE);
  let intentId: string;
  let fingerprint: string;

  if (existing) {
    intentId = existing.id;
    fingerprint = existing.intent_fingerprint;
  } else {
    const registered = await registerFixture(registry);
    assert.equal(registered.ok, true);
    if (!registered.ok) throw new Error("fixture registration failed");

    intentId = registered.intent.id;
    fingerprint = registered.intent.intentFingerprint;
  }

  const approved = await approveIntentAuthorization(
    { nonce: NONCE, merchantWallet: MERCHANT, fingerprint },
    { client: registry.client },
  );

  assert.equal(approved.ok, true);
  if (!approved.ok) throw new Error("fixture approval failed");

  return { intentId, fingerprint };
}

// ---------------------------------------------------------------------------
// 1-5: Token creation, verification, tampering, expiry, wallet binding
// ---------------------------------------------------------------------------

test("a signed intent token round-trips with its wallet, nonce and fingerprint", () => {
  const signed = createIntentToken(INTENT, MERCHANT, {
    secret: SECRET,
    now: NOW,
    nonce: NONCE,
  });

  assert.equal(signed.token.startsWith(`${INTENT_TOKEN_PREFIX}.`), true);
  assert.equal(signed.token.split(".").length, 3);
  assert.equal(
    signed.fingerprint,
    intentAuthorizationFingerprint(INTENT, MERCHANT, NONCE),
  );
  assert.equal(
    Date.parse(signed.expiresAt) - NOW.getTime(),
    INTENT_TOKEN_TTL_SECONDS * 1000,
  );

  const verified = verifyIntentToken(signed.token, {
    secret: SECRET,
    now: NOW,
    wallet: MERCHANT,
  });

  assert.equal(verified.ok, true);
  if (!verified.ok) return;

  assert.equal(verified.payload.wallet, MERCHANT);
  assert.equal(verified.payload.nonce, NONCE);
  assert.equal(verified.payload.fingerprint, signed.fingerprint);
  assert.deepEqual(verified.payload.intent, INTENT);
});

test("a token with a tampered signature or payload is rejected", () => {
  const signed = createIntentToken(INTENT, MERCHANT, {
    secret: SECRET,
    now: NOW,
    nonce: NONCE,
  });
  const [prefix, payload, signature] = signed.token.split(".");

  const flip = (value: string) =>
    `${value.slice(0, -1)}${value.endsWith("A") ? "B" : "A"}`;

  const badSignature = verifyIntentToken(
    `${prefix}.${payload}.${flip(signature)}`,
    { secret: SECRET, now: NOW },
  );
  assert.equal(badSignature.ok, false);
  if (!badSignature.ok) {
    assert.equal(badSignature.reason, "invalid_signature");
  }

  const badPayload = verifyIntentToken(`${prefix}.${flip(payload)}.${signature}`, {
    secret: SECRET,
    now: NOW,
  });
  assert.equal(badPayload.ok, false);
  if (!badPayload.ok) assert.equal(badPayload.reason, "invalid_signature");
});

test("an expired token is rejected at the boundary", () => {
  const signed = createIntentToken(INTENT, MERCHANT, {
    secret: SECRET,
    now: NOW,
    nonce: NONCE,
  });

  const justValid = verifyIntentToken(signed.token, {
    secret: SECRET,
    now: new Date(NOW.getTime() + (INTENT_TOKEN_TTL_SECONDS - 1) * 1000),
  });
  assert.equal(justValid.ok, true);

  const expired = verifyIntentToken(signed.token, {
    secret: SECRET,
    now: new Date(NOW.getTime() + (INTENT_TOKEN_TTL_SECONDS + 1) * 1000),
  });
  assert.equal(expired.ok, false);
  if (!expired.ok) assert.equal(expired.reason, "expired");
});

test("a token is unusable by a different merchant wallet", () => {
  const signed = createIntentToken(INTENT, MERCHANT, {
    secret: SECRET,
    now: NOW,
    nonce: NONCE,
  });

  const wrongMerchant = verifyIntentToken(signed.token, {
    secret: SECRET,
    now: NOW,
    wallet: OTHER_MERCHANT,
  });

  assert.equal(wrongMerchant.ok, false);
  if (!wrongMerchant.ok) assert.equal(wrongMerchant.reason, "wrong_merchant");
});

test("malformed tokens and a wrong prefix are rejected without throwing", () => {
  const signed = createIntentToken(INTENT, MERCHANT, {
    secret: SECRET,
    now: NOW,
    nonce: NONCE,
  });
  const [prefix, payload, signature] = signed.token.split(".");

  for (const token of [
    "",
    "ppi1",
    "ppi1.a",
    "ppi1..",
    `ppd1.${payload}.${signature}`,
    `${prefix}.${payload}.${signature}.extra`,
    "x".repeat(MAX_INTENT_TOKEN_LENGTH + 1),
  ]) {
    const verified = verifyIntentToken(token, { secret: SECRET, now: NOW });
    assert.equal(verified.ok, false, token.slice(0, 16));
    if (!verified.ok) assert.equal(verified.reason, "malformed");
  }
});

// ---------------------------------------------------------------------------
// 6: Fingerprint mismatch
// ---------------------------------------------------------------------------

test("a correctly signed token whose payload does not match its fingerprint is rejected", () => {
  const iat = Math.floor(NOW.getTime() / 1000);
  const payload = {
    v: 1,
    wallet: MERCHANT,
    nonce: NONCE,
    iat,
    exp: iat + INTENT_TOKEN_TTL_SECONDS,
    intent: INTENT,
    // A well-formed but wrong fingerprint.
    fingerprint: "0".repeat(64),
  };

  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );
  const signature = createHmac("sha256", SECRET)
    .update(`${INTENT_TOKEN_PREFIX}.${encoded}`, "utf8")
    .digest("base64url");

  const verified = verifyIntentToken(
    `${INTENT_TOKEN_PREFIX}.${encoded}.${signature}`,
    { secret: SECRET, now: NOW, wallet: MERCHANT },
  );

  assert.equal(verified.ok, false);
  if (!verified.ok) assert.equal(verified.reason, "fingerprint_mismatch");
});

test("an intent whose amount display disagrees with its lamports cannot be registered", async () => {
  const registry = createInMemoryRegistry({ now: () => NOW.getTime() });

  const result = await registerFixture(registry, {
    intent: intentWith({ amountSol: "9" }),
  });

  assert.equal(result.ok, false);
  if (result.ok) return;

  assert.equal(result.code, "invalid");
  assert.match(result.message, /displayed amount/i);
  assert.equal(registry.counters.inserts, 0);
});

// ---------------------------------------------------------------------------
// 5: Secret handling
// ---------------------------------------------------------------------------

test("the signing secret must be present and at least 32 characters", () => {
  const original = process.env.AI_INTENT_TOKEN_SECRET;

  try {
    delete process.env.AI_INTENT_TOKEN_SECRET;
    assert.equal(resolveIntentTokenSecret(), null);

    process.env.AI_INTENT_TOKEN_SECRET = "x".repeat(
      MIN_INTENT_TOKEN_SECRET_LENGTH - 1,
    );
    assert.equal(resolveIntentTokenSecret(), null);

    process.env.AI_INTENT_TOKEN_SECRET = `  ${"x".repeat(
      MIN_INTENT_TOKEN_SECRET_LENGTH,
    )}  `;
    assert.equal(
      resolveIntentTokenSecret(),
      "x".repeat(MIN_INTENT_TOKEN_SECRET_LENGTH),
    );
  } finally {
    if (original === undefined) {
      delete process.env.AI_INTENT_TOKEN_SECRET;
    } else {
      process.env.AI_INTENT_TOKEN_SECRET = original;
    }
  }
});

test("intent authorization fails closed without a secret and never registers", async () => {
  const registry = createInMemoryRegistry({ now: () => NOW.getTime() });

  const result = await createAuthorizedIntent(
    { intent: INTENT, merchantWallet: MERCHANT, now: NOW, nonce: NONCE },
    { client: registry.client, resolveSecret: () => null },
  );

  assert.equal(result.ok, false);
  if (result.ok) return;

  assert.equal(result.code, "secret_unavailable");
  assert.equal(registry.counters.inserts, 0);
});

test("a weak environment secret disables intent authorization (fail closed)", async () => {
  const original = process.env.AI_INTENT_TOKEN_SECRET;
  const registry = createInMemoryRegistry({ now: () => NOW.getTime() });

  try {
    process.env.AI_INTENT_TOKEN_SECRET = "too-short";

    const result = await createAuthorizedIntent(
      { intent: INTENT, merchantWallet: MERCHANT, now: NOW, nonce: NONCE },
      { client: registry.client },
    );

    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "secret_unavailable");
    assert.equal(registry.counters.inserts, 0);
  } finally {
    if (original === undefined) {
      delete process.env.AI_INTENT_TOKEN_SECRET;
    } else {
      process.env.AI_INTENT_TOKEN_SECRET = original;
    }
  }
});

// ---------------------------------------------------------------------------
// 7-9: Single-use, duplicate and concurrent consumption
// ---------------------------------------------------------------------------

test("registration persists a draft row bound to the merchant and nonce", async () => {
  const registry = createInMemoryRegistry({ now: () => NOW.getTime() });

  const result = await registerFixture(registry);

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.intent.status, "draft");
  assert.equal(result.intent.merchantWallet, MERCHANT);
  assert.equal(result.intent.nonce, NONCE);
  assert.equal(
    result.intent.intentFingerprint,
    intentAuthorizationFingerprint(INTENT, MERCHANT, NONCE),
  );
  assert.equal(result.intent.recipientAddress, RECIPIENT);
  assert.equal(result.intent.amountLamports, "2000000000");
  assert.equal(result.intent.transactionSignature, null);
  assert.equal(result.intent.verifiedAt, null);
});

test("approval consumes the authorization exactly once", async () => {
  const registry = createInMemoryRegistry({ now: () => NOW.getTime() });
  const registered = await registerFixture(registry);
  assert.equal(registered.ok, true);
  if (!registered.ok) return;

  const fingerprint = registered.intent.intentFingerprint;

  const first = await approveIntentAuthorization(
    { nonce: NONCE, merchantWallet: MERCHANT, fingerprint },
    { client: registry.client },
  );

  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.outcome, "approved");
  assert.equal(first.intent.status, "approved");

  const second = await approveIntentAuthorization(
    { nonce: NONCE, merchantWallet: MERCHANT, fingerprint },
    { client: registry.client },
  );

  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(second.outcome, "already_approved");
  assert.equal(second.intent.id, first.intent.id);
  assert.equal(registry.rows.size, 1);
});

test("concurrent approvals produce one approval and one idempotent replay", async () => {
  const registry = createInMemoryRegistry({ now: () => NOW.getTime() });
  const registered = await registerFixture(registry);
  assert.equal(registered.ok, true);
  if (!registered.ok) return;

  const fingerprint = registered.intent.intentFingerprint;

  const [left, right] = await Promise.all([
    approveIntentAuthorization(
      { nonce: NONCE, merchantWallet: MERCHANT, fingerprint },
      { client: registry.client },
    ),
    approveIntentAuthorization(
      { nonce: NONCE, merchantWallet: MERCHANT, fingerprint },
      { client: registry.client },
    ),
  ]);

  assert.equal(left.ok, true);
  assert.equal(right.ok, true);

  const outcomes = [left, right].flatMap((result) =>
    result.ok ? [result.outcome] : [],
  );

  assert.deepEqual(outcomes.sort(), ["already_approved", "approved"]);
  assert.equal(registry.rows.size, 1);
  assert.equal(registry.rows.get(NONCE)?.status, "approved");
});

// ---------------------------------------------------------------------------
// 10-11: Cross-merchant and revoked authorizations
// ---------------------------------------------------------------------------

test("another merchant cannot approve or revoke the intent", async () => {
  const registry = createInMemoryRegistry({ now: () => NOW.getTime() });
  const registered = await registerFixture(registry);
  assert.equal(registered.ok, true);
  if (!registered.ok) return;

  const fingerprint = registered.intent.intentFingerprint;

  const approve = await approveIntentAuthorization(
    { nonce: NONCE, merchantWallet: OTHER_MERCHANT, fingerprint },
    { client: registry.client },
  );
  assert.equal(approve.ok, false);
  if (!approve.ok && approve.code === "rejected") {
    assert.equal(approve.outcome, "wrong_merchant");
  }

  const revoke = await revokeIntentAuthorization(
    { nonce: NONCE, merchantWallet: OTHER_MERCHANT },
    { client: registry.client },
  );
  assert.equal(revoke.ok, false);
  if (!revoke.ok && revoke.code === "rejected") {
    assert.equal(revoke.outcome, "wrong_merchant");
  }

  const reauthorize = await reauthorizeIntentAuthorization(
    { nonce: NONCE, merchantWallet: OTHER_MERCHANT, intent: INTENT, now: NOW },
    { client: registry.client },
  );
  assert.equal(reauthorize.ok, false);
  if (!reauthorize.ok && reauthorize.code === "rejected") {
    assert.equal(reauthorize.outcome, "wrong_merchant");
  }

  assert.equal(registry.rows.get(NONCE)?.status, "draft");
});

test("a revoked authorization can never be approved", async () => {
  const registry = createInMemoryRegistry({ now: () => NOW.getTime() });
  const registered = await registerFixture(registry);
  assert.equal(registered.ok, true);
  if (!registered.ok) return;

  const fingerprint = registered.intent.intentFingerprint;

  const revoked = await revokeIntentAuthorization(
    { nonce: NONCE, merchantWallet: MERCHANT },
    { client: registry.client },
  );
  assert.equal(revoked.ok, true);

  const approved = await approveIntentAuthorization(
    { nonce: NONCE, merchantWallet: MERCHANT, fingerprint },
    { client: registry.client },
  );

  assert.equal(approved.ok, false);
  if (!approved.ok && approved.code === "rejected") {
    assert.equal(approved.outcome, "revoked");
  }
  assert.equal(registry.rows.get(NONCE)?.status, "cancelled");
});

test("revocation is idempotent", async () => {
  const registry = createInMemoryRegistry({ now: () => NOW.getTime() });
  const registered = await registerFixture(registry);
  assert.equal(registered.ok, true);
  if (!registered.ok) return;

  const first = await revokeIntentAuthorization(
    { nonce: NONCE, merchantWallet: MERCHANT },
    { client: registry.client },
  );
  const second = await revokeIntentAuthorization(
    { nonce: NONCE, merchantWallet: MERCHANT },
    { client: registry.client },
  );

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (second.ok) assert.equal(second.outcome, "revoked");
  assert.equal(registry.rows.get(NONCE)?.status, "cancelled");
});

test("an approved but unsigned intent can be cancelled exactly once", async () => {
  const registry = createInMemoryRegistry({ now: () => NOW.getTime() });
  const registered = await registerFixture(registry);
  assert.equal(registered.ok, true);
  if (!registered.ok) return;

  const approved = await approveIntentAuthorization(
    {
      nonce: NONCE,
      merchantWallet: MERCHANT,
      fingerprint: registered.intent.intentFingerprint,
    },
    { client: registry.client },
  );
  assert.equal(approved.ok, true);

  const afterApproval = await revokeIntentAuthorization(
    { nonce: NONCE, merchantWallet: MERCHANT },
    { client: registry.client },
  );

  assert.equal(afterApproval.ok, true);
  if (afterApproval.ok) assert.equal(afterApproval.outcome, "revoked");
  assert.equal(registry.rows.get(NONCE)?.status, "cancelled");

  // A cancelled intent can never be submitted.
  const submitted = await submitIntentTransaction(
    {
      nonce: NONCE,
      merchantWallet: MERCHANT,
      signature: SIGNATURE,
      payerAddress: MERCHANT,
      transactionBase64: TRANSACTION_BASE64,
    },
    { client: registry.client },
  );

  assert.equal(submitted.ok, false);
  if (!submitted.ok && submitted.code === "rejected") {
    assert.equal(submitted.outcome, "invalid_status");
  }
  assert.equal(registry.rows.get(NONCE)?.transaction_signature, null);
});

test("revocation cannot undo a submission or a verification", async () => {
  const registry = createInMemoryRegistry({ now: () => NOW.getTime() });
  await approvedFixture(registry);

  const submitted = await submitIntentTransaction(
    {
      nonce: NONCE,
      merchantWallet: MERCHANT,
      signature: SIGNATURE,
      payerAddress: MERCHANT,
      transactionBase64: TRANSACTION_BASE64,
    },
    { client: registry.client },
  );
  assert.equal(submitted.ok, true);

  const afterSubmit = await revokeIntentAuthorization(
    { nonce: NONCE, merchantWallet: MERCHANT },
    { client: registry.client },
  );
  assert.equal(afterSubmit.ok, false);
  if (!afterSubmit.ok && afterSubmit.code === "rejected") {
    assert.equal(afterSubmit.outcome, "approved");
  }
  assert.equal(registry.rows.get(NONCE)?.status, "submitted");

  const verified = await verifyIntentTransaction(
    {
      nonce: NONCE,
      merchantWallet: MERCHANT,
      signature: SIGNATURE,
      payerAddress: MERCHANT,
    },
    { client: registry.client },
  );
  assert.equal(verified.ok, true);

  const afterVerify = await revokeIntentAuthorization(
    { nonce: NONCE, merchantWallet: MERCHANT },
    { client: registry.client },
  );
  assert.equal(afterVerify.ok, false);
  if (!afterVerify.ok && afterVerify.code === "rejected") {
    assert.equal(afterVerify.outcome, "approved");
  }
  assert.equal(registry.rows.get(NONCE)?.status, "verified");
});

// ---------------------------------------------------------------------------
// 12: Expired database intent
// ---------------------------------------------------------------------------

test("an intent that expires in the database is marked expired and cannot be approved", async () => {
  let nowMs = NOW.getTime();
  const registry = createInMemoryRegistry({ now: () => nowMs });

  const registered = await registerFixture(registry, {
    expiresAt: new Date(NOW.getTime() + 1000).toISOString(),
  });
  assert.equal(registered.ok, true);
  if (!registered.ok) return;

  nowMs = NOW.getTime() + 2000;

  const approved = await approveIntentAuthorization(
    {
      nonce: NONCE,
      merchantWallet: MERCHANT,
      fingerprint: registered.intent.intentFingerprint,
    },
    { client: registry.client },
  );

  assert.equal(approved.ok, false);
  if (!approved.ok && approved.code === "rejected") {
    assert.equal(approved.outcome, "expired");
  }
  assert.equal(registry.rows.get(NONCE)?.status, "expired");
});

test("registration refuses an authorization that is already expired", async () => {
  const registry = createInMemoryRegistry({ now: () => NOW.getTime() });

  const result = await registerFixture(registry, {
    expiresAt: new Date(NOW.getTime() - 1000).toISOString(),
  });

  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.message, /expiry must be in the future/i);
  assert.equal(registry.counters.inserts, 0);
});

// ---------------------------------------------------------------------------
// Re-authorization
// ---------------------------------------------------------------------------

test("re-authorization rotates the nonce in place and keeps the intent identity", async () => {
  const registry = createInMemoryRegistry({ now: () => NOW.getTime() });
  const registered = await registerFixture(registry);
  assert.equal(registered.ok, true);
  if (!registered.ok) return;

  const edited = intentWith({ amountLamports: "3000000000", amountSol: "3" });
  const newNonce = generateIntentNonce();

  const reauthorized = await reauthorizeIntentAuthorization(
    {
      nonce: NONCE,
      merchantWallet: MERCHANT,
      intent: edited,
      now: NOW,
      newNonce,
    },
    { client: registry.client },
  );

  assert.equal(reauthorized.ok, true);
  if (!reauthorized.ok) return;

  assert.equal(reauthorized.intent.id, registered.intent.id);
  assert.equal(reauthorized.intent.reference, registered.intent.reference);
  assert.equal(reauthorized.intent.nonce, newNonce);
  assert.equal(reauthorized.intent.amountLamports, "3000000000");
  assert.equal(registry.rows.size, 1);

  // The old token's nonce no longer resolves.
  const stale = await approveIntentAuthorization(
    {
      nonce: NONCE,
      merchantWallet: MERCHANT,
      fingerprint: registered.intent.intentFingerprint,
    },
    { client: registry.client },
  );
  assert.equal(stale.ok, false);
  if (!stale.ok && stale.code === "rejected") {
    assert.equal(stale.outcome, "unknown");
  }

  const fresh = await approveIntentAuthorization(
    {
      nonce: newNonce,
      merchantWallet: MERCHANT,
      fingerprint: reauthorized.intent.intentFingerprint,
    },
    { client: registry.client },
  );
  assert.equal(fresh.ok, true);
  if (fresh.ok) assert.equal(fresh.outcome, "approved");
});

test("an approved intent cannot be re-authorized", async () => {
  const registry = createInMemoryRegistry({ now: () => NOW.getTime() });
  const registered = await registerFixture(registry);
  assert.equal(registered.ok, true);
  if (!registered.ok) return;

  await approveIntentAuthorization(
    {
      nonce: NONCE,
      merchantWallet: MERCHANT,
      fingerprint: registered.intent.intentFingerprint,
    },
    { client: registry.client },
  );

  const reauthorized = await reauthorizeIntentAuthorization(
    { nonce: NONCE, merchantWallet: MERCHANT, intent: INTENT, now: NOW },
    { client: registry.client },
  );

  assert.equal(reauthorized.ok, false);
  if (!reauthorized.ok && reauthorized.code === "rejected") {
    assert.equal(reauthorized.outcome, "approved");
  }
});

// ---------------------------------------------------------------------------
// Registration safety and duplicate keys
// ---------------------------------------------------------------------------

test("a duplicate nonce or reference is reported as a conflict", async () => {
  const registry = createInMemoryRegistry({ now: () => NOW.getTime() });

  const first = await registerFixture(registry, { reference: REFERENCE });
  assert.equal(first.ok, true);

  const duplicateNonce = await registerFixture(registry, {
    reference: RECIPIENT_TWO,
  });
  assert.equal(duplicateNonce.ok, false);
  if (!duplicateNonce.ok) assert.equal(duplicateNonce.code, "conflict");

  const duplicateReference = await registerFixture(registry, {
    nonce: "b".repeat(32),
    reference: REFERENCE,
  });
  assert.equal(duplicateReference.ok, false);
  if (!duplicateReference.ok) assert.equal(duplicateReference.code, "conflict");

  assert.equal(registry.rows.size, 1);
});

test("unsafe intents are rejected before any insert", async () => {
  const registry = createInMemoryRegistry({ now: () => NOW.getTime() });

  const cases: Array<{ intent: PaymentIntent; match: RegExp }> = [
    {
      intent: intentWith({ recipientAddress: "not-a-valid-address" }),
      match: /recipient/i,
    },
    {
      intent: intentWith({ amountLamports: "0", amountSol: "0" }),
      match: /greater than zero/i,
    },
    {
      intent: intentWith({
        amountLamports: "10000000001",
        amountSol: "10.000000001",
      }),
      match: /10 SOL or less/i,
    },
    {
      intent: intentWith({ purpose: "  " }),
      match: /purpose/i,
    },
    {
      intent: intentWith({ currency: "GHS" as unknown as "SOL" }),
      match: /SOL/i,
    },
    {
      intent: intentWith({
        sourceKind: "address",
        sourcePaymentRequestReference: REFERENCE,
      }),
      match: /must not carry/i,
    },
  ];

  for (const item of cases) {
    const result = await registerFixture(registry, { intent: item.intent });
    assert.equal(result.ok, false, item.match.source);
    if (!result.ok) assert.match(result.message, item.match);
  }

  assert.equal(registry.counters.inserts, 0);
});

test("createAuthorizedIntent returns no token when registration fails", async () => {
  const registry = createInMemoryRegistry({ now: () => NOW.getTime() });

  const first = await createAuthorizedIntent(
    { intent: INTENT, merchantWallet: MERCHANT, now: NOW, nonce: NONCE },
    { client: registry.client, resolveSecret: () => SECRET },
  );
  assert.equal(first.ok, true);

  // Same nonce again: the registry rejects the duplicate, so no token leaks.
  const second = await createAuthorizedIntent(
    { intent: INTENT, merchantWallet: MERCHANT, now: NOW, nonce: NONCE },
    { client: registry.client, resolveSecret: () => SECRET },
  );

  assert.equal(second.ok, false);
  if (!second.ok) assert.equal(second.code, "conflict");
  assert.equal(registry.rows.size, 1);
});

test("createAuthorizedIntent issues a verifiable token bound to the session wallet", async () => {
  const registry = createInMemoryRegistry({ now: () => NOW.getTime() });

  const created = await createAuthorizedIntent(
    { intent: INTENT, merchantWallet: MERCHANT, now: NOW, nonce: NONCE },
    { client: registry.client, resolveSecret: () => SECRET },
  );

  assert.equal(created.ok, true);
  if (!created.ok) return;

  const verified = verifyIntentToken(created.token, {
    secret: SECRET,
    now: NOW,
    wallet: MERCHANT,
  });

  assert.equal(verified.ok, true);
  if (!verified.ok) return;

  assert.equal(verified.payload.wallet, MERCHANT);
  assert.equal(verified.payload.nonce, created.intent.nonce);
  assert.equal(verified.payload.fingerprint, created.intent.intentFingerprint);

  const asOtherMerchant = verifyIntentToken(created.token, {
    secret: SECRET,
    now: NOW,
    wallet: OTHER_MERCHANT,
  });
  assert.equal(asOtherMerchant.ok, false);
});

// ---------------------------------------------------------------------------
// Helpers and exported invariants
// ---------------------------------------------------------------------------

test("intent ids and nonces have the required shape", () => {
  const id = generateIntentId();
  assert.match(id, /^AI-[0-9A-F]{8}$/);

  const nonce = generateIntentNonce();
  assert.match(nonce, /^[0-9a-f]{32}$/);

  assert.match(
    intentAuthorizationExpiry(NOW),
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
  );
});

test("the row mapper rejects malformed database rows", () => {
  const base = {
    id: "AI-00000000",
    merchant_wallet: MERCHANT,
    status: "draft",
    recipient_address: RECIPIENT,
    amount_lamports: "2000000000",
    purpose: "website development deposit",
    reference: REFERENCE,
    source_kind: "address",
    source_payment_request_reference: null,
    nonce: NONCE,
    intent_fingerprint: "c".repeat(64),
    transaction_signature: null,
    payer_address: null,
    verified_at: null,
    expires_at: EXPIRES_AT,
    created_at: NOW.toISOString(),
  };

  assert.notEqual(mapAgentPaymentIntentRow(base), null);

  for (const variant of [
    { ...base, status: "paid" },
    { ...base, recipient_address: "nope" },
    { ...base, amount_lamports: "2.5" },
    { ...base, nonce: "xyz" },
    { ...base, intent_fingerprint: "c".repeat(63) },
    { ...base, source_kind: "address", source_payment_request_reference: REFERENCE },
    { ...base, id: "" },
  ]) {
    assert.equal(
      mapAgentPaymentIntentRow(variant),
      null,
      JSON.stringify(variant).slice(0, 80),
    );
  }
});

// ---------------------------------------------------------------------------
// Stage 4 Step 1: authoritative approval window, submission, verification
//
// These tests drive the real registry operations against the in-memory client.
// The client mirrors the SQL state machine; it is NOT PostgreSQL. Row locking,
// constraint enforcement and grants are proved against the migration text in
// the structural tests further down, and the optional .mjs suite can exercise a
// real database (see tests/agent-intent-lifecycle.pg-concurrency.test.mjs).
// ---------------------------------------------------------------------------

test("an authoritative reload is scoped to the owning merchant and fails closed", async () => {
  const registry = createInMemoryRegistry({ now: () => NOW.getTime() });
  const registered = await registerFixture(registry);
  assert.equal(registered.ok, true);
  if (!registered.ok) return;

  const byNonce = await loadIntentForMerchant(
    { merchantWallet: MERCHANT, nonce: NONCE },
    { client: registry.client },
  );

  assert.equal(byNonce.ok, true);
  if (!byNonce.ok) return;
  assert.equal(byNonce.intent.id, registered.intent.id);
  assert.equal(byNonce.intent.amountLamports, "2000000000");
  assert.equal(byNonce.intent.recipientAddress, RECIPIENT);
  assert.equal(byNonce.intent.status, "draft");

  const byId = await loadIntentForMerchant(
    { merchantWallet: MERCHANT, id: registered.intent.id },
    { client: registry.client },
  );
  assert.equal(byId.ok, true);
  if (byId.ok) assert.equal(byId.intent.nonce, NONCE);

  const otherMerchant = await loadIntentForMerchant(
    { merchantWallet: OTHER_MERCHANT, nonce: NONCE },
    { client: registry.client },
  );
  assert.equal(otherMerchant.ok, false);
  if (!otherMerchant.ok) assert.equal(otherMerchant.code, "not_found");

  const unknown = await loadIntentForMerchant(
    { merchantWallet: MERCHANT, nonce: "b".repeat(32) },
    { client: registry.client },
  );
  assert.equal(unknown.ok, false);
  if (!unknown.ok) assert.equal(unknown.code, "not_found");

  const bothSelectors = await loadIntentForMerchant(
    { merchantWallet: MERCHANT, nonce: NONCE, id: registered.intent.id },
    { client: registry.client },
  );
  assert.equal(bothSelectors.ok, false);
  if (!bothSelectors.ok) assert.equal(bothSelectors.code, "invalid");

  const failing: IntentRegistryClient = {
    ...registry.client,
    async getIntent() {
      return { data: null, error: { message: "connection reset" } };
    },
  };

  const unavailable = await loadIntentForMerchant(
    { merchantWallet: MERCHANT, nonce: NONCE },
    { client: failing },
  );
  assert.equal(unavailable.ok, false);
  if (!unavailable.ok) assert.equal(unavailable.code, "unavailable");
});

test("submission requires an approved intent and records signature, payer and time", async () => {
  const registry = createInMemoryRegistry({ now: () => NOW.getTime() });
  await registerFixture(registry);

  const beforeApproval = await submitIntentTransaction(
    {
      nonce: NONCE,
      merchantWallet: MERCHANT,
      signature: SIGNATURE,
      payerAddress: MERCHANT,
      transactionBase64: TRANSACTION_BASE64,
    },
    { client: registry.client },
  );

  assert.equal(beforeApproval.ok, false);
  if (!beforeApproval.ok && beforeApproval.code === "rejected") {
    assert.equal(beforeApproval.outcome, "not_approved");
  }
  assert.equal(registry.rows.get(NONCE)?.transaction_signature, null);

  await approvedFixture(registry);

  const submitted = await submitIntentTransaction(
    {
      nonce: NONCE,
      merchantWallet: MERCHANT,
      signature: SIGNATURE,
      payerAddress: MERCHANT,
      transactionBase64: TRANSACTION_BASE64,
    },
    { client: registry.client },
  );

  assert.equal(submitted.ok, true);
  if (!submitted.ok) return;

  assert.equal(submitted.outcome, "submitted");
  assert.equal(submitted.intent.status, "submitted");
  assert.equal(submitted.intent.transactionSignature, SIGNATURE);
  assert.equal(submitted.intent.payerAddress, MERCHANT);
  assert.equal(submitted.intent.submittedAt, NOW.toISOString());
  assert.equal(submitted.intent.verifiedAt, null);
});

test("a duplicate identical submission is idempotent and cannot rotate the signature", async () => {
  const registry = createInMemoryRegistry({ now: () => NOW.getTime() });
  await approvedFixture(registry);

  const first = await submitIntentTransaction(
    {
      nonce: NONCE,
      merchantWallet: MERCHANT,
      signature: SIGNATURE,
      payerAddress: MERCHANT,
      transactionBase64: TRANSACTION_BASE64,
    },
    { client: registry.client },
  );
  assert.equal(first.ok, true);
  if (!first.ok) return;

  const replay = await submitIntentTransaction(
    {
      nonce: NONCE,
      merchantWallet: MERCHANT,
      signature: SIGNATURE,
      payerAddress: MERCHANT,
      transactionBase64: TRANSACTION_BASE64,
    },
    { client: registry.client },
  );

  assert.equal(replay.ok, true);
  if (!replay.ok) return;
  assert.equal(replay.outcome, "already_submitted");
  assert.equal(replay.intent.submittedAt, first.intent.submittedAt);
  assert.equal(registry.rows.size, 1);

  const differentSignature = await submitIntentTransaction(
    {
      nonce: NONCE,
      merchantWallet: MERCHANT,
      signature: SIGNATURE_TWO,
      payerAddress: MERCHANT,
      transactionBase64: TRANSACTION_BASE64,
    },
    { client: registry.client },
  );

  assert.equal(differentSignature.ok, false);
  if (!differentSignature.ok && differentSignature.code === "rejected") {
    assert.equal(differentSignature.outcome, "signature_conflict");
  }
  assert.equal(registry.rows.get(NONCE)?.transaction_signature, SIGNATURE);
});

test("concurrent submissions of different signatures record exactly one transaction", async () => {
  const registry = createInMemoryRegistry({ now: () => NOW.getTime() });
  await approvedFixture(registry);

  const [left, right] = await Promise.all([
    submitIntentTransaction(
    {
        nonce: NONCE,
        merchantWallet: MERCHANT,
        signature: SIGNATURE_TWO,
        payerAddress: MERCHANT,
        transactionBase64: TRANSACTION_BASE64,
      },
      { client: registry.client },
    ),
    submitIntentTransaction(
    {
        nonce: NONCE,
        merchantWallet: MERCHANT,
        signature: SIGNATURE_THREE,
        payerAddress: MERCHANT,
        transactionBase64: TRANSACTION_BASE64,
      },
      { client: registry.client },
    ),
  ]);

  assert.equal([left, right].filter((result) => result.ok).length, 1);

  const conflict = [left, right].find((result) => !result.ok);
  assert.notEqual(conflict, undefined);
  if (conflict && !conflict.ok && conflict.code === "rejected") {
    assert.equal(conflict.outcome, "signature_conflict");
  }

  const row = registry.rows.get(NONCE);
  assert.equal(row?.status, "submitted");
  assert.equal(
    row?.transaction_signature === SIGNATURE_TWO ||
      row?.transaction_signature === SIGNATURE_THREE,
    true,
  );
});

test("a substituted payer or malformed signature never reaches the database", async () => {
  const registry = createInMemoryRegistry({ now: () => NOW.getTime() });
  await approvedFixture(registry);

  const attempts = registry.counters.submits;

  const substitutedPayer = await submitIntentTransaction(
    {
      nonce: NONCE,
      merchantWallet: MERCHANT,
      signature: SIGNATURE,
      payerAddress: OTHER_MERCHANT,
      transactionBase64: TRANSACTION_BASE64,
    },
    { client: registry.client },
  );
  assert.equal(substitutedPayer.ok, false);
  if (!substitutedPayer.ok) assert.equal(substitutedPayer.code, "invalid");

  const malformedSignature = await submitIntentTransaction(
    {
      nonce: NONCE,
      merchantWallet: MERCHANT,
      signature: "not-a-signature",
      payerAddress: MERCHANT,
      transactionBase64: TRANSACTION_BASE64,
    },
    { client: registry.client },
  );
  assert.equal(malformedSignature.ok, false);
  if (!malformedSignature.ok) assert.equal(malformedSignature.code, "invalid");

  assert.equal(registry.counters.submits, attempts);
  assert.equal(registry.rows.get(NONCE)?.status, "approved");
});

test("submission is refused after the approval window and a re-approval only rotates the window", async () => {
  let nowMs = NOW.getTime();
  const registry = createInMemoryRegistry({ now: () => nowMs });
  const { fingerprint } = await approvedFixture(registry);

  const firstWindow = registry.rows.get(NONCE)?.approval_expires_at;
  assert.equal(Date.parse(firstWindow ?? ""), NOW.getTime() + APPROVAL_WINDOW_MS);

  nowMs = NOW.getTime() + APPROVAL_WINDOW_MS + 1;

  const expired = await submitIntentTransaction(
    {
      nonce: NONCE,
      merchantWallet: MERCHANT,
      signature: SIGNATURE,
      payerAddress: MERCHANT,
      transactionBase64: TRANSACTION_BASE64,
    },
    { client: registry.client },
  );

  assert.equal(expired.ok, false);
  if (!expired.ok && expired.code === "rejected") {
    assert.equal(expired.outcome, "approval_expired");
  }
  assert.equal(registry.rows.get(NONCE)?.status, "approved");
  assert.equal(registry.rows.get(NONCE)?.transaction_signature, null);

  const refreshed = await approveIntentAuthorization(
    { nonce: NONCE, merchantWallet: MERCHANT, fingerprint },
    { client: registry.client },
  );

  assert.equal(refreshed.ok, true);
  if (!refreshed.ok) return;
  assert.equal(refreshed.outcome, "approved");
  assert.equal(
    Date.parse(refreshed.intent.approvalExpiresAt ?? ""),
    nowMs + APPROVAL_WINDOW_MS,
  );
  assert.equal(refreshed.intent.id, registry.rows.get(NONCE)?.id);
  assert.equal(registry.rows.size, 1);

  const submitted = await submitIntentTransaction(
    {
      nonce: NONCE,
      merchantWallet: MERCHANT,
      signature: SIGNATURE,
      payerAddress: MERCHANT,
      transactionBase64: TRANSACTION_BASE64,
    },
    { client: registry.client },
  );
  assert.equal(submitted.ok, true);
});

test("verification is impossible before submission", async () => {
  const registry = createInMemoryRegistry({ now: () => NOW.getTime() });
  await registerFixture(registry);

  const draft = await verifyIntentTransaction(
    {
      nonce: NONCE,
      merchantWallet: MERCHANT,
      signature: SIGNATURE,
      payerAddress: MERCHANT,
    },
    { client: registry.client },
  );

  assert.equal(draft.ok, false);
  if (!draft.ok && draft.code === "rejected") {
    assert.equal(draft.outcome, "not_submitted");
  }

  await approvedFixture(registry);

  const approved = await verifyIntentTransaction(
    {
      nonce: NONCE,
      merchantWallet: MERCHANT,
      signature: SIGNATURE,
      payerAddress: MERCHANT,
    },
    { client: registry.client },
  );

  assert.equal(approved.ok, false);
  if (!approved.ok && approved.code === "rejected") {
    assert.equal(approved.outcome, "not_submitted");
  }
  assert.equal(registry.rows.get(NONCE)?.status, "approved");
});

test("verification only accepts the exact submitted signature and payer", async () => {
  const registry = createInMemoryRegistry({ now: () => NOW.getTime() });
  await approvedFixture(registry);

  await submitIntentTransaction(
    {
      nonce: NONCE,
      merchantWallet: MERCHANT,
      signature: SIGNATURE,
      payerAddress: MERCHANT,
      transactionBase64: TRANSACTION_BASE64,
    },
    { client: registry.client },
  );

  const wrongSignature = await verifyIntentTransaction(
    {
      nonce: NONCE,
      merchantWallet: MERCHANT,
      signature: SIGNATURE_TWO,
      payerAddress: MERCHANT,
    },
    { client: registry.client },
  );

  assert.equal(wrongSignature.ok, false);
  if (!wrongSignature.ok && wrongSignature.code === "rejected") {
    assert.equal(wrongSignature.outcome, "signature_mismatch");
  }
  assert.equal(registry.rows.get(NONCE)?.status, "submitted");
  assert.equal(registry.rows.get(NONCE)?.verified_at, null);

  // The database-level payer guard is still asserted directly against the fake.
  const substitutedPayer = await registry.client.verifyIntent({
    nonce: NONCE,
    merchantWallet: MERCHANT,
    signature: SIGNATURE,
    payerAddress: OTHER_MERCHANT,
  });
  assert.equal(
    (substitutedPayer.data as { outcome?: string } | undefined)?.outcome,
    "payer_mismatch",
  );

  const beforeDb = registry.counters.verifies;
  const refused = await verifyIntentTransaction(
    {
      nonce: NONCE,
      merchantWallet: MERCHANT,
      signature: SIGNATURE,
      payerAddress: OTHER_MERCHANT,
    },
    { client: registry.client },
  );
  assert.equal(refused.ok, false);
  if (!refused.ok) assert.equal(refused.code, "invalid");
  assert.equal(registry.counters.verifies, beforeDb);
});

test("successful verification is idempotent and a verified intent cannot be re-pointed", async () => {
  const registry = createInMemoryRegistry({ now: () => NOW.getTime() });
  await approvedFixture(registry);

  await submitIntentTransaction(
    {
      nonce: NONCE,
      merchantWallet: MERCHANT,
      signature: SIGNATURE,
      payerAddress: MERCHANT,
      transactionBase64: TRANSACTION_BASE64,
    },
    { client: registry.client },
  );

  const verified = await verifyIntentTransaction(
    {
      nonce: NONCE,
      merchantWallet: MERCHANT,
      signature: SIGNATURE,
      payerAddress: MERCHANT,
    },
    { client: registry.client },
  );

  assert.equal(verified.ok, true);
  if (!verified.ok) return;
  assert.equal(verified.outcome, "verified");
  assert.equal(verified.intent.status, "verified");
  assert.equal(verified.intent.verifiedAt, NOW.toISOString());

  const replay = await verifyIntentTransaction(
    {
      nonce: NONCE,
      merchantWallet: MERCHANT,
      signature: SIGNATURE,
      payerAddress: MERCHANT,
    },
    { client: registry.client },
  );
  assert.equal(replay.ok, true);
  if (replay.ok) assert.equal(replay.outcome, "already_verified");

  const rePointed = await verifyIntentTransaction(
    {
      nonce: NONCE,
      merchantWallet: MERCHANT,
      signature: SIGNATURE_TWO,
      payerAddress: MERCHANT,
    },
    { client: registry.client },
  );
  assert.equal(rePointed.ok, false);
  if (!rePointed.ok && rePointed.code === "rejected") {
    assert.equal(rePointed.outcome, "signature_conflict");
  }
  assert.equal(registry.rows.get(NONCE)?.transaction_signature, SIGNATURE);
  assert.equal(registry.rows.get(NONCE)?.status, "verified");
});

test("a definitive failure is recorded once for the submitted signature only", async () => {
  const registry = createInMemoryRegistry({ now: () => NOW.getTime() });
  await approvedFixture(registry);

  const beforeSubmit = await failIntentTransaction(
    {
      nonce: NONCE,
      merchantWallet: MERCHANT,
      signature: SIGNATURE,
      reason: AGENT_INTENT_FAILURE_REASONS[0],
    },
    { client: registry.client },
  );
  assert.equal(beforeSubmit.ok, false);
  if (!beforeSubmit.ok && beforeSubmit.code === "rejected") {
    assert.equal(beforeSubmit.outcome, "not_submitted");
  }

  await submitIntentTransaction(
    {
      nonce: NONCE,
      merchantWallet: MERCHANT,
      signature: SIGNATURE,
      payerAddress: MERCHANT,
      transactionBase64: TRANSACTION_BASE64,
    },
    { client: registry.client },
  );

  const attempts = registry.counters.fails;

  // A timeout or wallet rejection is retryable and not an allowlisted failure.
  for (const reason of ["network_timeout", "wallet_rejected", "rpc_unavailable"]) {
    const refused = await failIntentTransaction(
      {
        nonce: NONCE,
        merchantWallet: MERCHANT,
        signature: SIGNATURE,
        reason,
      },
      { client: registry.client },
    );
    assert.equal(refused.ok, false, reason);
    if (!refused.ok) assert.equal(refused.code, "invalid", reason);
  }
  assert.equal(registry.counters.fails, attempts);
  assert.equal(registry.rows.get(NONCE)?.status, "submitted");

  const wrongSignature = await failIntentTransaction(
    {
      nonce: NONCE,
      merchantWallet: MERCHANT,
      signature: SIGNATURE_TWO,
      reason: AGENT_INTENT_FAILURE_REASONS[0],
    },
    { client: registry.client },
  );
  assert.equal(wrongSignature.ok, false);
  if (!wrongSignature.ok && wrongSignature.code === "rejected") {
    assert.equal(wrongSignature.outcome, "signature_mismatch");
  }

  const failed = await failIntentTransaction(
    {
      nonce: NONCE,
      merchantWallet: MERCHANT,
      signature: SIGNATURE,
      reason: AGENT_INTENT_FAILURE_REASONS[0],
    },
    { client: registry.client },
  );

  assert.equal(failed.ok, true);
  if (!failed.ok) return;
  assert.equal(failed.outcome, "failed");
  assert.equal(failed.intent.status, "failed");
  assert.equal(failed.intent.failureReason, AGENT_INTENT_FAILURE_REASONS[0]);
  assert.equal(failed.intent.transactionSignature, SIGNATURE);

  const replay = await failIntentTransaction(
    {
      nonce: NONCE,
      merchantWallet: MERCHANT,
      signature: SIGNATURE,
      reason: AGENT_INTENT_FAILURE_REASONS[0],
    },
    { client: registry.client },
  );
  assert.equal(replay.ok, true);
  if (replay.ok) assert.equal(replay.outcome, "already_failed");
});

test("a verified settlement can never be marked failed or re-submitted", async () => {
  const registry = createInMemoryRegistry({ now: () => NOW.getTime() });
  await approvedFixture(registry);

  await submitIntentTransaction(
    {
      nonce: NONCE,
      merchantWallet: MERCHANT,
      signature: SIGNATURE,
      payerAddress: MERCHANT,
      transactionBase64: TRANSACTION_BASE64,
    },
    { client: registry.client },
  );

  const verified = await verifyIntentTransaction(
    {
      nonce: NONCE,
      merchantWallet: MERCHANT,
      signature: SIGNATURE,
      payerAddress: MERCHANT,
    },
    { client: registry.client },
  );
  assert.equal(verified.ok, true);
  if (!verified.ok) return;

  const failure = await failIntentTransaction(
    {
      nonce: NONCE,
      merchantWallet: MERCHANT,
      signature: SIGNATURE,
      reason: AGENT_INTENT_FAILURE_REASONS[0],
    },
    { client: registry.client },
  );

  assert.equal(failure.ok, false);
  if (!failure.ok && failure.code === "rejected") {
    assert.equal(failure.outcome, "already_verified");
  }

  const resubmission = await submitIntentTransaction(
    {
      nonce: NONCE,
      merchantWallet: MERCHANT,
      signature: SIGNATURE,
      payerAddress: MERCHANT,
      transactionBase64: TRANSACTION_BASE64,
    },
    { client: registry.client },
  );
  assert.equal(resubmission.ok, false);
  if (!resubmission.ok && resubmission.code === "rejected") {
    assert.equal(resubmission.outcome, "already_verified");
  }

  assert.equal(registry.rows.get(NONCE)?.status, "verified");
  assert.equal(registry.rows.get(NONCE)?.verified_at, NOW.toISOString());
  assert.equal(registry.rows.get(NONCE)?.failure_reason, null);
});

test("another merchant cannot submit, verify, fail or cancel the intent", async () => {
  const registry = createInMemoryRegistry({ now: () => NOW.getTime() });
  await approvedFixture(registry);

  const results = await Promise.all([
    submitIntentTransaction(
    {
        nonce: NONCE,
        merchantWallet: OTHER_MERCHANT,
        signature: SIGNATURE,
        payerAddress: OTHER_MERCHANT,
        transactionBase64: TRANSACTION_BASE64,
      },
      { client: registry.client },
    ),
    verifyIntentTransaction(
      {
        nonce: NONCE,
        merchantWallet: OTHER_MERCHANT,
        signature: SIGNATURE,
        payerAddress: OTHER_MERCHANT,
      },
      { client: registry.client },
    ),
    failIntentTransaction(
      {
        nonce: NONCE,
        merchantWallet: OTHER_MERCHANT,
        signature: SIGNATURE,
        reason: AGENT_INTENT_FAILURE_REASONS[0],
      },
      { client: registry.client },
    ),
  ]);

  for (const result of results) {
    assert.equal(result.ok, false);
    if (!result.ok && result.code === "rejected") {
      assert.equal(result.outcome, "wrong_merchant");
    }
  }

  assert.equal(registry.rows.get(NONCE)?.status, "approved");
  assert.equal(registry.rows.get(NONCE)?.transaction_signature, null);
});

test("the row mapper requires lifecycle evidence for advanced statuses", () => {
  const base = {
    id: "AI-00000000",
    merchant_wallet: MERCHANT,
    status: "draft",
    recipient_address: RECIPIENT,
    amount_lamports: "2000000000",
    purpose: "website development deposit",
    reference: REFERENCE,
    source_kind: "address",
    source_payment_request_reference: null,
    nonce: NONCE,
    intent_fingerprint: "c".repeat(64),
    transaction_signature: null,
    payer_address: null,
    verified_at: null,
    expires_at: EXPIRES_AT,
    created_at: NOW.toISOString(),
    approved_at: null,
    approval_expires_at: null,
    submitted_at: null,
    failure_reason: null,
  };

  assert.notEqual(mapAgentPaymentIntentRow(base), null);

  const approved = {
    ...base,
    status: "approved",
    approved_at: NOW.toISOString(),
    approval_expires_at: new Date(
      NOW.getTime() + APPROVAL_WINDOW_MS,
    ).toISOString(),
  };

  assert.notEqual(mapAgentPaymentIntentRow(approved), null);

  // Missing approval evidence, malformed timestamps and missing submission
  // evidence can never be treated as a valid authorization.
  for (const variant of [
    { ...base, status: "approved" },
    { ...base, status: "approved", approved_at: "yesterday" },
    { ...approved, approval_expires_at: null },
    {
      ...approved,
      status: "submitted",
    },
    {
      ...approved,
      status: "verified",
      transaction_signature: SIGNATURE,
      submitted_at: NOW.toISOString(),
      payer_address: MERCHANT,
      verified_at: NOW.toISOString(),
      failure_reason: "x",
    },
    { ...base, status: "failed" },
  ]) {
    assert.equal(
      mapAgentPaymentIntentRow(variant),
      null,
      JSON.stringify(variant).slice(0, 80),
    );
  }

  const verified = {
    ...approved,
    status: "verified",
    transaction_signature: SIGNATURE,
    submitted_at: NOW.toISOString(),
    payer_address: MERCHANT,
    verified_at: NOW.toISOString(),
  };

  assert.notEqual(mapAgentPaymentIntentRow(verified), null);
});

// ---------------------------------------------------------------------------
// 13-14: Migration and database access guarantees (structural, not executed)
// ---------------------------------------------------------------------------

const MIGRATION = readFileSync(
  new URL(
    "../supabase/migrations/20261124120000_agent_payment_intents.sql",
    import.meta.url,
  ),
  "utf8",
);

test("the migration defines the full intent lifecycle and required columns", () => {
  assert.match(
    MIGRATION,
    /create table if not exists public\.agent_payment_intents/i,
  );

  for (const column of [
    "id",
    "merchant_wallet",
    "status",
    "recipient_address",
    "amount_lamports",
    "purpose",
    "reference",
    "source_kind",
    "source_payment_request_reference",
    "nonce",
    "intent_fingerprint",
    "transaction_signature",
    "payer_address",
    "verified_at",
    "expires_at",
    "created_at",
  ]) {
    assert.match(MIGRATION, new RegExp(`\\b${column}\\b`, "i"), column);
  }

  assert.match(
    MIGRATION,
    /agent_intent_status_valid[\s\S]*?'draft'[\s\S]*?'approved'[\s\S]*?'submitted'[\s\S]*?'verified'[\s\S]*?'rejected'[\s\S]*?'expired'[\s\S]*?'cancelled'[\s\S]*?'failed'/i,
  );
});

test("the migration enforces integer amounts, the 10 SOL cap and verified evidence", () => {
  assert.match(MIGRATION, /amount_lamports ~ '\^\[0-9\]\{1,11\}\$'/i);
  assert.match(MIGRATION, /agent_intent_amount_bounds/i);
  assert.match(MIGRATION, /<= 10000000000/);
  assert.match(MIGRATION, /agent_intent_verified_consistency/i);
  assert.match(MIGRATION, /status <> 'verified'/i);
  assert.match(MIGRATION, /transaction_signature IS NOT NULL/i);
  assert.match(MIGRATION, /payer_address IS NOT NULL/i);
  assert.match(MIGRATION, /verified_at IS NOT NULL/i);
});

test("unique nonce, unique reference and a partial unique signature index exist", () => {
  assert.match(
    MIGRATION,
    /create unique index if not exists agent_intent_nonce_key[\s\S]*?\(nonce\)/i,
  );
  assert.match(
    MIGRATION,
    /create unique index if not exists agent_intent_reference_key[\s\S]*?\(reference\)/i,
  );
  assert.match(
    MIGRATION,
    /create unique index if not exists agent_intent_signature_key[\s\S]*?\(transaction_signature\)[\s\S]*?where transaction_signature is not null/i,
  );
});

test("the registry is service-role only and denies every client role", () => {
  assert.match(MIGRATION, /enable row level security/i);
  assert.match(
    MIGRATION,
    /revoke all on table public\.agent_payment_intents from public/i,
  );
  assert.match(
    MIGRATION,
    /revoke all on table public\.agent_payment_intents from anon/i,
  );
  assert.match(
    MIGRATION,
    /revoke all on table public\.agent_payment_intents from authenticated/i,
  );
  assert.match(
    MIGRATION,
    /grant select, insert, update on table public\.agent_payment_intents to service_role/i,
  );
  assert.match(
    MIGRATION,
    /create policy "no client access to agent payment intents"/i,
  );
  assert.match(MIGRATION, /using \(false\)/i);
  assert.match(MIGRATION, /with check \(false\)/i);

  // No client grant, and no DELETE privilege at all: intents are retained.
  // Match only real GRANT statements so prose in comments cannot trip this.
  assert.doesNotMatch(MIGRATION, /^\s*grant\b[^;]*\bto anon\b/im);
  assert.doesNotMatch(MIGRATION, /^\s*grant\b[^;]*\bdelete\b/im);
});

test("every RPC locks its row, runs as the invoker and pins search_path", () => {
  const lower = MIGRATION.toLowerCase();
  const functionStarts = [
    "create or replace function public.approve_agent_payment_intent",
    "create or replace function public.reauthorize_agent_payment_intent",
    "create or replace function public.revoke_agent_payment_intent",
  ];

  for (const start of functionStarts) {
    const from = lower.indexOf(start);
    const to = lower.indexOf("$$;", from);
    assert.notEqual(from, -1, start);
    assert.notEqual(to, -1, start);

    const body = MIGRATION.slice(from, to);

    assert.match(body, /for update/i, start);
    assert.match(body, /security invoker/i, start);
    assert.match(body, /set search_path = public/i, start);
    assert.match(body, /merchant_wallet <> p_merchant_wallet/i, start);
  }

  // No function may silently escalate to the migration owner.
  assert.doesNotMatch(MIGRATION, /security definer/i);
  assert.match(MIGRATION, /for update/gi);
});

test("every RPC is executable by service_role only", () => {
  for (const signature of [
    "public\\.approve_agent_payment_intent\\(\\s*TEXT, TEXT, TEXT\\s*\\)",
    "public\\.reauthorize_agent_payment_intent\\(\\s*TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, TEXT\\s*\\)",
    "public\\.revoke_agent_payment_intent\\(\\s*TEXT, TEXT\\s*\\)",
  ]) {
    assert.match(
      MIGRATION,
      new RegExp(`revoke all on function ${signature}[\\s\\S]*?from public`, "i"),
      signature,
    );
    assert.match(
      MIGRATION,
      new RegExp(`revoke all on function ${signature}[\\s\\S]*?from anon`, "i"),
      signature,
    );
    assert.match(
      MIGRATION,
      new RegExp(
        `revoke all on function ${signature}[\\s\\S]*?from authenticated`,
        "i",
      ),
      signature,
    );
    assert.match(
      MIGRATION,
      new RegExp(
        `grant execute on function ${signature}[\\s\\S]*?to service_role`,
        "i",
      ),
      signature,
    );
  }
});

test("approval is idempotent in SQL and re-authorization rotates in place", () => {
  const lower = MIGRATION.toLowerCase();

  const approve = lower.slice(
    lower.indexOf(
      "create or replace function public.approve_agent_payment_intent",
    ),
    lower.indexOf("$$;", lower.indexOf(
      "create or replace function public.approve_agent_payment_intent",
    )),
  );

  assert.match(approve, /'already_approved'/);
  assert.match(approve, /status in \('approved', 'submitted', 'verified'\)/);
  assert.match(approve, /set status = 'approved'/);
  assert.match(approve, /set status = 'expired'/);

  const reauthorize = lower.slice(
    lower.indexOf(
      "create or replace function public.reauthorize_agent_payment_intent",
    ),
    lower.indexOf("$$;", lower.indexOf(
      "create or replace function public.reauthorize_agent_payment_intent",
    )),
  );

  assert.match(reauthorize, /set\s+nonce = p_new_nonce/);
  assert.match(reauthorize, /intent_fingerprint = p_new_fingerprint/);
  assert.match(reauthorize, /where id = v_intent\.id/);
});

// ---------------------------------------------------------------------------
// Module boundary
// ---------------------------------------------------------------------------

const REGISTRY_SOURCE = readFileSync(
  new URL("../src/lib/ai/intent-registry.ts", import.meta.url),
  "utf8",
);
const TOKEN_SOURCE = readFileSync(
  new URL("../src/lib/ai/intent-token.ts", import.meta.url),
  "utf8",
);

test("the registry never builds, signs or submits a transaction", () => {
  for (const forbidden of [
    /createTransactionMessage/,
    /getTransferSolInstruction/,
    /buildPaymentTransfer/,
    /signTransaction/,
    /sendTransaction/,
    /@solana\/kit-plugin-wallet/,
    /@solana\/react/,
  ]) {
    assert.doesNotMatch(REGISTRY_SOURCE, forbidden, String(forbidden));
    assert.doesNotMatch(TOKEN_SOURCE, forbidden, String(forbidden));
  }
});

test("the token module imports only node:crypto, not the browser or AI SDKs", () => {
  assert.match(TOKEN_SOURCE, /from "node:crypto"/);
  for (const forbidden of [
    /@google\/genai/,
    /openrouter/i,
    /next\/server/,
    /\bwindow\./,
    /\bdocument\./,
    /localStorage/,
  ]) {
    assert.doesNotMatch(TOKEN_SOURCE, forbidden, String(forbidden));
  }
});

test("the registry requires the wallet argument rather than reading it from data", () => {
  assert.match(REGISTRY_SOURCE, /merchantWallet: string/);
  assert.doesNotMatch(REGISTRY_SOURCE, /body\.merchant/);
  assert.doesNotMatch(REGISTRY_SOURCE, /request\.json/);
});

// ---------------------------------------------------------------------------
// Stage 4 Step 1: lifecycle migration (structural, never executed here)
// ---------------------------------------------------------------------------

const LIFECYCLE_MIGRATION = readFileSync(
  new URL(
    "../supabase/migrations/20261126130000_agent_payment_intent_lifecycle.sql",
    import.meta.url,
  ),
  "utf8",
);
const LIFECYCLE = LIFECYCLE_MIGRATION.toLowerCase();

function lifecycleFunction(name: string): string {
  const from = LIFECYCLE.indexOf(`create or replace function public.${name}`);
  assert.notEqual(from, -1, name);

  const to = LIFECYCLE.indexOf("$$;", from);
  assert.notEqual(to, -1, name);

  return LIFECYCLE.slice(from, to);
}

test("the lifecycle migration only adds columns and backfills fail-closed", () => {
  for (const column of [
    "approved_at",
    "approval_expires_at",
    "submitted_at",
    "failure_reason",
  ]) {
    assert.match(
      LIFECYCLE,
      new RegExp(`add column if not exists ${column}`, "i"),
      column,
    );
  }

  assert.match(
    LIFECYCLE,
    /approved_at = coalesce\(approved_at, created_at\)[\s\S]*?where status in \('approved', 'submitted', 'verified'\)/,
  );
  assert.match(
    LIFECYCLE,
    /approval_expires_at = coalesce\([\s\S]*?greatest\(created_at \+ interval '1 second', now\(\)\)/,
  );
  // Legacy partial data is normalised before constraints are added.
  assert.match(LIFECYCLE, /set approval_expires_at = approved_at \+ interval '5 minutes'/);
  assert.match(LIFECYCLE, /set approved_at = approval_expires_at - interval '5 minutes'/);
  assert.match(LIFECYCLE, /set failure_reason = 'legacy_failure'/);

  // Additive only: nothing is dropped, deleted or retyped.
  assert.doesNotMatch(LIFECYCLE, /drop table/i);
  assert.doesNotMatch(LIFECYCLE, /drop column/i);
  assert.doesNotMatch(LIFECYCLE, /delete from/i);
  assert.doesNotMatch(LIFECYCLE, /alter column amount_lamports/i);
  assert.match(LIFECYCLE, /begin;/);
  assert.match(LIFECYCLE, /commit;/);

  // Rerun safety: conditional constraint creation and CREATE OR REPLACE only.
  assert.doesNotMatch(LIFECYCLE, /drop function/i);
  assert.match(LIFECYCLE, /if not exists \([\s\S]*?pg_constraint/i);
});

test("the lifecycle constraints bind approvals, submissions and failures", () => {
  for (const constraint of [
    "agent_intent_approved_consistency",
    "agent_intent_approval_window_valid",
    "agent_intent_submitted_consistency",
    "agent_intent_failure_consistency",
  ]) {
    assert.match(LIFECYCLE, new RegExp(`constraint ${constraint}`, "i"));
  }

  assert.match(
    LIFECYCLE,
    /status not in \('approved', 'submitted', 'verified'\)[\s\S]*?approved_at is not null and approval_expires_at is not null/,
  );
  assert.match(LIFECYCLE, /approval_expires_at > approved_at/);
  assert.match(
    LIFECYCLE,
    /status not in \('submitted', 'verified'\)[\s\S]*?or submitted_at is not null/,
  );
  assert.match(
    LIFECYCLE,
    /status <> 'failed'[\s\S]*?failure_reason is not null[\s\S]*?between 3 and 64/,
  );
});

test("every lifecycle RPC locks its row, runs as invoker and pins search_path", () => {
  for (const name of [
    "approve_agent_payment_intent",
    "revoke_agent_payment_intent",
    "submit_agent_payment_intent",
    "verify_agent_payment_intent",
    "fail_agent_payment_intent",
  ]) {
    const body = lifecycleFunction(name);

    assert.match(body, /for update/i, name);
    assert.match(body, /security invoker/i, name);
    assert.match(body, /set search_path = public/i, name);
    assert.match(body, /merchant_wallet <> p_merchant_wallet/i, name);
    assert.doesNotMatch(body, /security definer/i, name);
  }

  assert.doesNotMatch(LIFECYCLE, /security definer/i);

  // No caller-supplied status and no caller-supplied verification time.
  assert.doesNotMatch(LIFECYCLE, /p_status/);
  assert.doesNotMatch(LIFECYCLE, /p_verified_at/);

  const verify = lifecycleFunction("verify_agent_payment_intent");
  assert.match(verify, /verified_at = now\(\)/);
});

test("the lifecycle RPCs enforce every allowed transition and refuse the rest", () => {
  const approve = lifecycleFunction("approve_agent_payment_intent");
  assert.match(approve, /intent_fingerprint <> p_fingerprint/);
  assert.match(approve, /'fingerprint_mismatch'/);
  assert.match(approve, /status in \('approved', 'submitted', 'verified'\)/);
  assert.match(approve, /'already_approved'/);
  assert.match(approve, /approval_expires_at = now\(\) \+ interval '5 minutes'/);
  assert.match(approve, /status = 'approved'/);
  assert.match(approve, /set status = 'expired'/);

  const submit = lifecycleFunction("submit_agent_payment_intent");
  assert.match(submit, /p_payer_address <> p_merchant_wallet/);
  assert.match(submit, /'not_approved'/);
  assert.match(submit, /'approval_expired'/);
  assert.match(submit, /'already_submitted'/);
  assert.match(submit, /'already_verified'/);
  assert.match(submit, /'signature_conflict'/);
  assert.match(submit, /when unique_violation then/);
  assert.match(submit, /transaction_signature = p_signature/);
  assert.match(submit, /submitted_at = now\(\)/);
  assert.doesNotMatch(submit, /status = 'failed'/i);

  const verify = lifecycleFunction("verify_agent_payment_intent");
  assert.match(verify, /'not_submitted'/);
  assert.match(verify, /'signature_mismatch'/);
  assert.match(verify, /'payer_mismatch'/);
  assert.match(verify, /'already_verified'/);
  assert.match(verify, /status = 'verified'/);
  assert.doesNotMatch(verify, /status = 'failed'/i);

  const fail = lifecycleFunction("fail_agent_payment_intent");
  assert.match(fail, /'not_submitted'/);
  assert.match(fail, /'signature_mismatch'/);
  assert.match(fail, /'already_verified'/);
  assert.match(fail, /'already_failed'/);
  assert.match(fail, /failure_reason = p_reason/);
  assert.match(fail, /status = 'failed'/);

  const revoke = lifecycleFunction("revoke_agent_payment_intent");
  assert.match(
    revoke,
    /status in \('submitted', 'verified'\)[\s\S]*?'outcome', 'approved'/,
  );
  assert.match(revoke, /status = 'cancelled'/);
  assert.match(
    revoke,
    /status not in \('draft', 'approved'\)[\s\S]*?'invalid_status'/,
  );
});

test("every lifecycle RPC is executable by service_role only", () => {
  for (const signature of [
    "public\\.approve_agent_payment_intent\\(\\s*text, text, text\\s*\\)",
    "public\\.revoke_agent_payment_intent\\(\\s*text, text\\s*\\)",
    "public\\.submit_agent_payment_intent\\(\\s*text, text, text, text\\s*\\)",
    "public\\.verify_agent_payment_intent\\(\\s*text, text, text, text\\s*\\)",
    "public\\.fail_agent_payment_intent\\(\\s*text, text, text, text\\s*\\)",
  ]) {
    assert.match(
      LIFECYCLE,
      new RegExp(`revoke all on function ${signature}[\\s\\S]*?from public`, "i"),
      signature,
    );
    assert.match(
      LIFECYCLE,
      new RegExp(`revoke all on function ${signature}[\\s\\S]*?from anon`, "i"),
      signature,
    );
    assert.match(
      LIFECYCLE,
      new RegExp(
        `revoke all on function ${signature}[\\s\\S]*?from authenticated`,
        "i",
      ),
      signature,
    );
    assert.match(
      LIFECYCLE,
      new RegExp(
        `grant execute on function ${signature}[\\s\\S]*?to service_role`,
        "i",
      ),
      signature,
    );
  }

  assert.doesNotMatch(
    LIFECYCLE,
    /^\s*grant\b[^;]*\bto (anon|authenticated|public)\b/im,
  );
});
