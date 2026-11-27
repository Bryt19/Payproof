/**
 * Real PostgreSQL concurrency test — PayProof Stage 4 Step 1
 * ============================================================================
 *
 * Exercises the deployed agent payment intent lifecycle RPCs from TWO
 * INDEPENDENT database backends against a real Postgres server:
 *
 *   1. approve_agent_payment_intent()  — concurrent approvals
 *   2. submit_agent_payment_intent()   — concurrent submissions of two
 *                                        different signatures
 *   3. verify_agent_payment_intent()   — exact-signature verification
 *   4. fail_agent_payment_intent()     — a verified settlement is final
 *
 * WHAT IT PROVES (only when it actually runs)
 *   * Both concurrent approval calls finish; exactly one row exists and exactly
 *     one approval window was written.
 *   * The second concurrent call really blocks on the row lock until the first
 *     transaction commits (it is not just sequential SQL).
 *   * Two different signatures cannot both be recorded: the loser reports
 *     signature_conflict and the stored signature never changes.
 *   * An elapsed approval window refuses submission and leaves the row
 *     approved; re-approval only rotates the window.
 *   * Verification requires the exact submitted signature, and a verified row
 *     cannot be failed.
 *   * The five lifecycle functions are SECURITY INVOKER and are not executable
 *     by anon/authenticated when those roles exist.
 *
 * The mocked suite (tests/ai-payment-intent-registry.node.test.ts) is NOT this
 * test: it simulates the SQL state machine in memory. Only this file talks to a
 * database, and it is excluded from `npm test` and from `tsc`.
 *
 * SAFETY
 *   * Refuses to run unless PAYPROOF_TEST_DATABASE_URL is set.
 *   * Refuses remote hosts unless PAYPROOF_ALLOW_REMOTE_TEST_DB=1, and refuses
 *     outright if the host matches NEXT_PUBLIC_SUPABASE_URL (production).
 *   * Refuses to run if the dedicated test wallet already has intent rows, so it
 *     can never delete or modify pre-existing records.
 *   * Deletes only rows for that one dedicated test wallet.
 *   * Never prints the connection string.
 *
 * PREREQUISITES (none present in this workspace)
 *   1. A scratch Postgres with the agent intent migrations applied (local
 *      Supabase via `supabase start`, or any disposable Postgres 14+).
 *   2. The pg driver:  npm i -D pg
 *   3. Run:
 *        PAYPROOF_TEST_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
 *        PAYPROOF_ALLOW_PG_CONCURRENCY_TEST=1 \
 *        node --test tests/agent-intent-lifecycle.pg-concurrency.test.mjs
 *
 * This file is .mjs on purpose: it never affects `tsc --noEmit` or the build.
 */

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";

// 44 base58 characters; not a real merchant wallet.
const TEST_MERCHANT = `${"1".repeat(43)}2`;
const RECIPIENT = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
// 32 base58 characters; `0` is not in the base58 alphabet.
const REFERENCE = randomBytes(16).toString("hex").replace(/0/g, "1");

// 64-byte base58 values, accepted by isSignature and by the SQL format check.
const SIGNATURE_A = "1".repeat(64);
const SIGNATURE_B = `${"1".repeat(63)}2`;

const CONNECTION_STRING = process.env.PAYPROOF_TEST_DATABASE_URL ?? "";
const OPT_IN = process.env.PAYPROOF_ALLOW_PG_CONCURRENCY_TEST === "1";
const ALLOW_REMOTE = process.env.PAYPROOF_ALLOW_REMOTE_TEST_DB === "1";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Returns a reason string when the test must not run, otherwise null. */
function refuseReason() {
  if (!CONNECTION_STRING) {
    return "PAYPROOF_TEST_DATABASE_URL is not set (no isolated test database configured)";
  }

  if (!OPT_IN) {
    return "PAYPROOF_ALLOW_PG_CONCURRENCY_TEST=1 is not set (explicit opt-in required)";
  }

  let target;
  try {
    target = new URL(CONNECTION_STRING);
  } catch {
    return "PAYPROOF_TEST_DATABASE_URL is not a valid postgres:// URL";
  }

  const host = target.hostname;

  const productionUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (productionUrl) {
    try {
      const productionHost = new URL(productionUrl).hostname;
      if (productionHost && host === productionHost) {
        return "refusing: PAYPROOF_TEST_DATABASE_URL points at NEXT_PUBLIC_SUPABASE_URL (production)";
      }
    } catch {
      // Malformed production URL is not our concern here.
    }
  }

  const looksRemote =
    !LOCAL_HOSTS.has(host) ||
    /supabase\.(co|in)$/i.test(host) ||
    /pooler\.supabase\.com$/i.test(host) ||
    /\.supabase\./i.test(host);

  if (looksRemote && !ALLOW_REMOTE) {
    return `refusing remote host "${host}" without PAYPROOF_ALLOW_REMOTE_TEST_DB=1`;
  }

  return null;
}

const SKIP_REASON = refuseReason();

async function loadPg() {
  try {
    const mod = await import("pg");
    return mod.default ?? mod;
  } catch (error) {
    if (error?.code === "ERR_MODULE_NOT_FOUND") {
      assert.fail("pg is not installed. Run: npm i -D pg");
    }
    throw error;
  }
}

test(
  "agent intent lifecycle: row locks, one approval, one signature",
  { skip: SKIP_REASON ?? false, timeout: 60_000 },
  async () => {
    const { Client } = await loadPg();

    const sessionA = new Client({
      connectionString: CONNECTION_STRING,
      application_name: "payproof-intent-lifecycle-A",
    });
    const sessionB = new Client({
      connectionString: CONNECTION_STRING,
      application_name: "payproof-intent-lifecycle-B",
    });

    const nonce = randomBytes(16).toString("hex");
    const intentId = `AI-${randomBytes(4).toString("hex").toUpperCase()}`;
    const fingerprint = randomBytes(32).toString("hex");

    let insertedRow = false;

    try {
      await sessionA.connect();
      await sessionB.connect();

      const pidA = (await sessionA.query("select pg_backend_pid() as pid")).rows[0].pid;
      const pidB = (await sessionB.query("select pg_backend_pid() as pid")).rows[0].pid;
      assert.notEqual(pidA, pidB, "the two calls must use separate backends");

      // ---------------------------------------------------------------
      // 1. Deployed functions are invoker, not definer
      // ---------------------------------------------------------------
      const functions = await sessionA.query(
        `select p.proname, p.prosecdef
           from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public'
            and p.proname = any($1::text[])
          order by p.proname`,
        [
          [
            "approve_agent_payment_intent",
            "revoke_agent_payment_intent",
            "submit_agent_payment_intent",
            "verify_agent_payment_intent",
            "fail_agent_payment_intent",
          ],
        ],
      );

      assert.equal(functions.rowCount, 5, "all five lifecycle functions must exist");
      for (const row of functions.rows) {
        assert.equal(row.prosecdef, false, `${row.proname} must be SECURITY INVOKER`);
      }

      for (const role of ["anon", "authenticated"]) {
        const { rows } = await sessionA.query(
          `select
             to_regrole($1) is not null as role_exists,
             count(*) filter (
               where has_function_privilege($1, p.oid, 'EXECUTE')
             )::int as executable
           from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public'
            and p.proname = any($2::text[])`,
          [
            role,
            [
              "approve_agent_payment_intent",
              "revoke_agent_payment_intent",
              "submit_agent_payment_intent",
              "verify_agent_payment_intent",
              "fail_agent_payment_intent",
            ],
          ],
        );

        if (rows[0].role_exists) {
          assert.equal(
            rows[0].executable,
            0,
            `${role} must not be able to execute lifecycle functions`,
          );
        }
      }

      // ---------------------------------------------------------------
      // 2. Precondition: the dedicated test wallet has no rows
      // ---------------------------------------------------------------
      const preexisting = await sessionA.query(
        `select count(*)::int as n
           from public.agent_payment_intents
          where merchant_wallet = $1`,
        [TEST_MERCHANT],
      );
      assert.equal(
        preexisting.rows[0].n,
        0,
        "the test wallet must have no pre-existing intents; refusing to touch real records",
      );

      // ---------------------------------------------------------------
      // 3. Fixture: one draft intent
      // ---------------------------------------------------------------
      await sessionA.query(
        `insert into public.agent_payment_intents
           (id, merchant_wallet, status, recipient_address, amount_lamports,
            purpose, reference, source_kind, nonce, intent_fingerprint, expires_at)
         values ($1, $2, 'draft', $3, '1000', 'lifecycle concurrency test',
                 $4, 'address', $5, $6, now() + interval '10 minutes')`,
        [intentId, TEST_MERCHANT, RECIPIENT, REFERENCE, nonce, fingerprint],
      );
      insertedRow = true;

      // ---------------------------------------------------------------
      // 4. Concurrent approvals: A locks the row, B must wait
      // ---------------------------------------------------------------
      await sessionA.query("set lock_timeout = '10s'");
      await sessionB.query("set lock_timeout = '10s'");

      await sessionA.query("begin");
      const approveA = await sessionA.query(
        `select public.approve_agent_payment_intent($1, $2, $3) as r`,
        [nonce, TEST_MERCHANT, fingerprint],
      );
      assert.equal(approveA.rows[0].r.outcome, "approved", "first approval must succeed");

      await sessionB.query("begin");
      let settledB = false;
      const pendingB = sessionB
        .query(`select public.approve_agent_payment_intent($1, $2, $3) as r`, [
          nonce,
          TEST_MERCHANT,
          fingerprint,
        ])
        .then((result) => {
          settledB = true;
          return result;
        });

      await sleep(300);
      assert.equal(settledB, false, "the second approval must block on the row lock");

      await sessionA.query("commit");
      const approveB = await pendingB;
      await sessionB.query("commit");

      assert.equal(
        approveB.rows[0].r.outcome,
        "already_approved",
        "the second approval must be an idempotent replay",
      );

      const afterApproval = await sessionA.query(
        `select id, status, approved_at, approval_expires_at,
                extract(epoch from (approval_expires_at - approved_at))::int as window_seconds
           from public.agent_payment_intents
          where merchant_wallet = $1`,
        [TEST_MERCHANT],
      );

      assert.equal(afterApproval.rowCount, 1, "exactly one intent row may exist");
      assert.equal(afterApproval.rows[0].status, "approved");
      assert.notEqual(afterApproval.rows[0].approved_at, null);
      assert.equal(afterApproval.rows[0].window_seconds, 300);

      // ---------------------------------------------------------------
      // 5. An elapsed window refuses submission without changing status
      // ---------------------------------------------------------------
      await sessionA.query(
        `update public.agent_payment_intents
            set approval_expires_at = now() - interval '1 second'
          where merchant_wallet = $1`,
        [TEST_MERCHANT],
      );

      const expired = await sessionA.query(
        `select public.submit_agent_payment_intent($1, $2, $3, $2) as r`,
        [nonce, TEST_MERCHANT, SIGNATURE_A],
      );
      assert.equal(expired.rows[0].r.outcome, "approval_expired");

      const stillApproved = await sessionA.query(
        `select status, transaction_signature
           from public.agent_payment_intents
          where merchant_wallet = $1`,
        [TEST_MERCHANT],
      );
      assert.equal(stillApproved.rows[0].status, "approved");
      assert.equal(stillApproved.rows[0].transaction_signature, null);

      const reapproved = await sessionA.query(
        `select public.approve_agent_payment_intent($1, $2, $3) as r`,
        [nonce, TEST_MERCHANT, fingerprint],
      );
      assert.equal(reapproved.rows[0].r.outcome, "approved");
      assert.equal(reapproved.rows[0].r.intent.id, intentId, "same row, same identity");

      // ---------------------------------------------------------------
      // 6. Concurrent submissions of two signatures: one wins
      // ---------------------------------------------------------------
      await sessionA.query("begin");
      const submitA = await sessionA.query(
        `select public.submit_agent_payment_intent($1, $2, $3, $2) as r`,
        [nonce, TEST_MERCHANT, SIGNATURE_A],
      );
      assert.equal(submitA.rows[0].r.outcome, "submitted");

      await sessionB.query("begin");
      let settledSubmit = false;
      const pendingSubmit = sessionB
        .query(`select public.submit_agent_payment_intent($1, $2, $3, $2) as r`, [
          nonce,
          TEST_MERCHANT,
          SIGNATURE_B,
        ])
        .then((result) => {
          settledSubmit = true;
          return result;
        });

      await sleep(300);
      assert.equal(settledSubmit, false, "the second submission must block on the row lock");

      await sessionA.query("commit");
      const submitB = await pendingSubmit;
      await sessionB.query("commit");

      assert.equal(submitB.rows[0].r.outcome, "signature_conflict");

      const stored = await sessionA.query(
        `select status, transaction_signature, payer_address, submitted_at
           from public.agent_payment_intents
          where merchant_wallet = $1`,
        [TEST_MERCHANT],
      );
      assert.equal(stored.rows[0].status, "submitted");
      assert.equal(stored.rows[0].transaction_signature, SIGNATURE_A);
      assert.equal(stored.rows[0].payer_address, TEST_MERCHANT);
      assert.notEqual(stored.rows[0].submitted_at, null);

      // ---------------------------------------------------------------
      // 7. Verification only accepts the recorded signature
      // ---------------------------------------------------------------
      const wrongSignature = await sessionA.query(
        `select public.verify_agent_payment_intent($1, $2, $3, $2) as r`,
        [nonce, TEST_MERCHANT, SIGNATURE_B],
      );
      assert.equal(wrongSignature.rows[0].r.outcome, "signature_mismatch");

      const wrongPayer = await sessionA.query(
        `select public.verify_agent_payment_intent($1, $2, $3, $4) as r`,
        [nonce, TEST_MERCHANT, SIGNATURE_A, RECIPIENT],
      );
      assert.equal(wrongPayer.rows[0].r.outcome, "payer_mismatch");

      const verified = await sessionA.query(
        `select public.verify_agent_payment_intent($1, $2, $3, $2) as r`,
        [nonce, TEST_MERCHANT, SIGNATURE_A],
      );
      assert.equal(verified.rows[0].r.outcome, "verified");
      assert.notEqual(verified.rows[0].r.intent.verified_at, null);

      const failure = await sessionA.query(
        `select public.fail_agent_payment_intent($1, $2, $3, 'onchain_transaction_failed') as r`,
        [nonce, TEST_MERCHANT, SIGNATURE_A],
      );
      assert.equal(failure.rows[0].r.outcome, "already_verified");

      const cancel = await sessionA.query(
        `select public.revoke_agent_payment_intent($1, $2) as r`,
        [nonce, TEST_MERCHANT],
      );
      assert.equal(cancel.rows[0].r.outcome, "approved", "a verified intent cannot be cancelled");

      const final = await sessionA.query(
        `select status, verified_at, failure_reason
           from public.agent_payment_intents
          where merchant_wallet = $1`,
        [TEST_MERCHANT],
      );
      assert.equal(final.rows[0].status, "verified");
      assert.notEqual(final.rows[0].verified_at, null);
      assert.equal(final.rows[0].failure_reason, null);
    } finally {
      try {
        await sessionA.query("rollback");
      } catch {
        // No transaction open — fine.
      }

      if (insertedRow) {
        await sessionA.query(
          `delete from public.agent_payment_intents where merchant_wallet = $1`,
          [TEST_MERCHANT],
        );
      }

      await sessionA.end().catch(() => {});
      await sessionB.end().catch(() => {});
    }
  },
);
