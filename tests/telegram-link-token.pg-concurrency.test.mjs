/**
 * Real PostgreSQL concurrency test — PayProof Stage 4.3B Step 1
 * ============================================================================
 *
 * Exercises public.atomic_generate_telegram_link_token() from TWO INDEPENDENT
 * database backends against a real Postgres server. It does not simulate
 * concurrency with sequential SQL: session B is fired while session A holds the
 * per-merchant transaction-level advisory lock, and the test asserts B was
 * blocked until A committed.
 *
 * WHAT IT PROVES
 *   1. The deployed function exists and uses pg_advisory_xact_lock +
 *      hashtextextended (read from pg_get_functiondef, not from the repo file).
 *   2. Both concurrent calls finish without unexpected database errors.
 *   3. Exactly one token remains unconsumed AND unrevoked for the test merchant.
 *   4. The losing token is revoked; the winner is pending with a future expiry.
 *   5. Another merchant's token is untouched.
 *   6. A pre-existing consumed token is untouched (consumed_at / revoked_at).
 *   7. The unique partial pending-token index and the unique token_hash index
 *      are still present and byte-identical before and after.
 *   8. Only this test's own rows are removed at the end.
 *
 * SAFETY
 *   * Refuses to run unless PAYPROOF_TEST_DATABASE_URL is set.
 *   * Refuses remote hosts unless PAYPROOF_ALLOW_REMOTE_TEST_DB=1, and refuses
 *     outright if the host matches NEXT_PUBLIC_SUPABASE_URL (production).
 *   * Refuses to run if either test merchant already has token rows, so it can
 *     never delete or modify pre-existing records.
 *   * Deletes only rows for the two dedicated test merchant addresses.
 *   * Never prints the connection string.
 *
 * PREREQUISITES (none present in this workspace)
 *   1. A scratch Postgres with the Telegram schema + function applied:
 *        supabase start                    # requires Docker Desktop
 *        # then apply the telegram migrations to the LOCAL db only
 *      or any disposable Postgres 14+ database you own.
 *   2. The pg driver:  npm i -D pg
 *   3. Run:
 *        PAYPROOF_TEST_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
 *        PAYPROOF_ALLOW_PG_CONCURRENCY_TEST=1 \
 *        npm run test:pg-concurrency
 *
 * This file is .mjs on purpose: it is excluded from tsconfig's **\/*.ts glob, so
 * it never affects `tsc --noEmit` or `next build`, and it is not part of
 * `npm test` because it needs a live database.
 */

import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import test from "node:test";

const TEST_MERCHANT = "PayProofConcurrencyTestMerchant000000000001";
const OTHER_MERCHANT = "PayProofConcurrencyTestMerchant000000000002";

const CONNECTION_STRING = process.env.PAYPROOF_TEST_DATABASE_URL ?? "";
const OPT_IN = process.env.PAYPROOF_ALLOW_PG_CONCURRENCY_TEST === "1";
const ALLOW_REMOTE = process.env.PAYPROOF_ALLOW_REMOTE_TEST_DB === "1";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);

function sha256Hex(input) {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

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

  // Never point at the production project, whatever else is configured.
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
  "atomic token generation: two sessions, exactly one pending token survives",
  { skip: SKIP_REASON ?? false, timeout: 60_000 },
  async () => {
    const { Client } = await loadPg();

    const sessionA = new Client({
      connectionString: CONNECTION_STRING,
      application_name: "payproof-link-token-A",
    });
    const sessionB = new Client({
      connectionString: CONNECTION_STRING,
      application_name: "payproof-link-token-B",
    });

    let insertedRows = false;

    const hashA = sha256Hex(`link-token-A:${randomBytes(16).toString("hex")}`);
    const hashB = sha256Hex(`link-token-B:${randomBytes(16).toString("hex")}`);
    const hashConsumed = sha256Hex(`link-token-consumed:${randomBytes(16).toString("hex")}`);
    const hashOther = sha256Hex(`link-token-other:${randomBytes(16).toString("hex")}`);

    assert.match(hashA, /^[0-9a-f]{64}$/);
    assert.match(hashB, /^[0-9a-f]{64}$/);
    assert.notEqual(hashA, hashB);

    try {
      await sessionA.connect();
      await sessionB.connect();

      // ---------------------------------------------------------------
      // 1. Independent backends
      // ---------------------------------------------------------------
      const pidA = (await sessionA.query("select pg_backend_pid() as pid")).rows[0].pid;
      const pidB = (await sessionB.query("select pg_backend_pid() as pid")).rows[0].pid;
      assert.notEqual(pidA, pidB, "the two calls must use separate backends");

      // ---------------------------------------------------------------
      // 2. Inspect the DEPLOYED function definition
      // ---------------------------------------------------------------
      const fn = await sessionA.query(
        `select pg_get_functiondef(p.oid) as def
           from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public'
            and p.proname = 'atomic_generate_telegram_link_token'`
      );

      assert.equal(fn.rowCount, 1, "atomic_generate_telegram_link_token must exist");
      const fnDef = fn.rows[0].def;
      assert.match(fnDef, /pg_advisory_xact_lock/i, "must use pg_advisory_xact_lock");
      assert.match(fnDef, /hashtextextended/i, "must hash the merchant address");

      // ---------------------------------------------------------------
      // 3. Indexes: capture before, discover by definition (names drift)
      // ---------------------------------------------------------------
      const readIndexes = async () => {
        const { rows } = await sessionA.query(
          `select indexname, indexdef
             from pg_indexes
            where schemaname = 'public'
              and tablename = 'telegram_link_tokens'
            order by indexname`
        );
        return rows;
      };

      const indexesBefore = await readIndexes();

      const pendingIndexes = indexesBefore.filter(
        (row) =>
          /unique index/i.test(row.indexdef) &&
          /where/i.test(row.indexdef) &&
          /consumed_at/i.test(row.indexdef) &&
          /expires_at/i.test(row.indexdef)
      );
      assert.equal(
        pendingIndexes.length,
        1,
        "exactly one unique partial pending-token index expected"
      );

      const hashIndexes = indexesBefore.filter(
        (row) => /unique index/i.test(row.indexdef) && /\(token_hash\)/i.test(row.indexdef)
      );
      assert.equal(hashIndexes.length, 1, "exactly one unique token_hash index expected");

      const invalidIndexes = await sessionA.query(
        `select count(*)::int as n
           from pg_index i
           join pg_class c on c.oid = i.indexrelid
           join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public'
            and c.relname = any($1::text[])
            and not i.indisvalid`,
        [[...pendingIndexes, ...hashIndexes].map((row) => row.indexname)]
      );
      assert.equal(invalidIndexes.rows[0].n, 0, "indexes must be valid");

      // ---------------------------------------------------------------
      // 4. Precondition: test merchants have no rows (never touch real data)
      // ---------------------------------------------------------------
      const preexisting = await sessionA.query(
        `select count(*)::int as n
           from public.telegram_link_tokens
          where merchant_wallet_address = any($1::text[])`,
        [[TEST_MERCHANT, OTHER_MERCHANT]]
      );
      assert.equal(
        preexisting.rows[0].n,
        0,
        "test merchants must have no pre-existing tokens; refusing to modify real records"
      );

      // ---------------------------------------------------------------
      // 5. Fixtures: a consumed token (must stay untouched) and another
      //    merchant's pending token (must stay untouched)
      // ---------------------------------------------------------------
      const consumedInsert = await sessionA.query(
        `insert into public.telegram_link_tokens
           (merchant_wallet_address, token_hash, expires_at, consumed_at, revoked_at)
         values ($1, $2, now() + interval '10 minutes', now() - interval '1 minute', null)
         returning id, consumed_at, revoked_at`,
        [TEST_MERCHANT, hashConsumed]
      );

      const otherInsert = await sessionA.query(
        `insert into public.telegram_link_tokens
           (merchant_wallet_address, token_hash, expires_at, consumed_at, revoked_at)
         values ($1, $2, now() + interval '10 minutes', null, null)
         returning id, expires_at, consumed_at, revoked_at`,
        [OTHER_MERCHANT, hashOther]
      );

      insertedRows = true;

      const consumedBefore = consumedInsert.rows[0];
      const otherBefore = otherInsert.rows[0];

      // ---------------------------------------------------------------
      // 6. Concurrent invocation from two independent sessions
      // ---------------------------------------------------------------
      await sessionA.query("set lock_timeout = '10s'");
      await sessionB.query("set lock_timeout = '10s'");

      await sessionA.query("begin");

      const resultA = await sessionA.query(
        "select * from public.atomic_generate_telegram_link_token($1, $2)",
        [TEST_MERCHANT, hashA]
      );
      assert.equal(resultA.rows[0].status, "success", "first call must succeed");

      await sessionB.query("begin");

      let settledB = false;
      const pendingB = sessionB
        .query("select * from public.atomic_generate_telegram_link_token($1, $2)", [
          TEST_MERCHANT,
          hashB,
        ])
        .then((result) => {
          settledB = true;
          return result;
        });

      // A still holds the advisory lock; B must not be able to finish.
      await sleep(300);
      const bWasBlocked = !settledB;

      await sessionA.query("commit");

      const resultB = await pendingB;
      await sessionB.query("commit");

      assert.equal(bWasBlocked, true, "second session must block on the advisory lock");
      assert.equal(resultB.rows[0].status, "success", "second call must succeed");
      assert.equal(
        resultA.rows[0].status,
        "success",
        "no unexpected database errors on either call"
      );

      // ---------------------------------------------------------------
      // 7. Exactly one unconsumed AND unrevoked token
      // ---------------------------------------------------------------
      const pendingRows = await sessionA.query(
        `select id, token_hash, expires_at, consumed_at, revoked_at
           from public.telegram_link_tokens
          where merchant_wallet_address = $1
            and consumed_at is null
            and revoked_at is null`,
        [TEST_MERCHANT]
      );

      assert.equal(
        pendingRows.rowCount,
        1,
        `expected exactly one pending token, found ${pendingRows.rowCount}`
      );

      const winner = pendingRows.rows[0];
      const winnerHash = winner.token_hash;
      const loserHash = winnerHash === hashA ? hashB : hashA;

      assert.ok(
        winnerHash === hashA || winnerHash === hashB,
        "the surviving token must be one of the two candidates"
      );
      assert.equal(winner.consumed_at, null);
      assert.equal(winner.revoked_at, null);
      assert.ok(
        new Date(winner.expires_at).getTime() > Date.now(),
        "winning token must not be expired"
      );

      // ---------------------------------------------------------------
      // 8. Both candidate rows exist; the loser is revoked
      // ---------------------------------------------------------------
      const candidateRows = await sessionA.query(
        `select token_hash, consumed_at, revoked_at, expires_at
           from public.telegram_link_tokens
          where merchant_wallet_address = $1
            and token_hash = any($2::text[])`,
        [TEST_MERCHANT, [hashA, hashB]]
      );

      assert.equal(candidateRows.rowCount, 2, "both candidate tokens must be recorded");

      const loser = candidateRows.rows.find((row) => row.token_hash === loserHash);
      assert.ok(loser, "losing token row must exist");
      assert.notEqual(loser.revoked_at, null, "losing token must be revoked");
      assert.equal(loser.consumed_at, null, "losing token must not be marked consumed");

      // ---------------------------------------------------------------
      // 9. Unrelated merchant untouched
      // ---------------------------------------------------------------
      const otherAfter = await sessionA.query(
        `select id, expires_at, consumed_at, revoked_at
           from public.telegram_link_tokens
          where merchant_wallet_address = $1 and token_hash = $2`,
        [OTHER_MERCHANT, hashOther]
      );

      assert.equal(otherAfter.rowCount, 1, "other merchant's token must still exist");
      assert.equal(otherAfter.rows[0].consumed_at, null);
      assert.equal(otherAfter.rows[0].revoked_at, null, "other merchant must not be revoked");
      assert.equal(
        new Date(otherAfter.rows[0].expires_at).getTime(),
        new Date(otherBefore.expires_at).getTime(),
        "other merchant's expiry must be unchanged"
      );

      // ---------------------------------------------------------------
      // 10. Consumed token untouched
      // ---------------------------------------------------------------
      const consumedAfter = await sessionA.query(
        `select consumed_at, revoked_at
           from public.telegram_link_tokens
          where merchant_wallet_address = $1 and token_hash = $2`,
        [TEST_MERCHANT, hashConsumed]
      );

      assert.equal(consumedAfter.rowCount, 1, "consumed token must still exist");
      assert.equal(consumedAfter.rows[0].revoked_at, null, "consumed token must not be revoked");
      assert.equal(
        new Date(consumedAfter.rows[0].consumed_at).getTime(),
        new Date(consumedBefore.consumed_at).getTime(),
        "consumed_at must be unchanged"
      );

      // ---------------------------------------------------------------
      // 11. No duplicate pending tokens for the merchant
      // ---------------------------------------------------------------
      const duplicates = await sessionA.query(
        `select count(*)::int as n
           from (
             select 1
               from public.telegram_link_tokens
              where merchant_wallet_address = $1
                and consumed_at is null
                and revoked_at is null
              group by merchant_wallet_address
             having count(*) > 1
           ) as dupes`,
        [TEST_MERCHANT]
      );
      assert.equal(duplicates.rows[0].n, 0, "no duplicate pending tokens allowed");

      // ---------------------------------------------------------------
      // 12. Index definitions unchanged
      // ---------------------------------------------------------------
      const indexesAfter = await readIndexes();
      assert.deepEqual(
        indexesAfter,
        indexesBefore,
        "telegram_link_tokens indexes must be unchanged"
      );
    } finally {
      // -----------------------------------------------------------------
      // 13. Cleanup: only this test's two merchant addresses.
      // -----------------------------------------------------------------
      try {
        await sessionA.query("rollback");
      } catch {
        // No transaction open — fine.
      }

      if (insertedRows) {
        await sessionA.query(
          `delete from public.telegram_link_tokens
            where merchant_wallet_address = any($1::text[])`,
          [[TEST_MERCHANT, OTHER_MERCHANT]]
        );
      }

      await sessionA.end().catch(() => {});
      await sessionB.end().catch(() => {});
    }
  }
);
