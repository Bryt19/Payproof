import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * The attempt RPCs run inside PostgreSQL, so their behaviour cannot be
 * exercised by the Node test runner. These assertions pin the parts of the
 * migration that make failed-payment recovery safe:
 *
 *   - issuance allows pending and failed requests but never resets history
 *   - expiry, single-use and the 5-outstanding-attempt window stay enforced
 *   - a rejection on a non-pending request is invalidated before the
 *     rejection-count increment, so it cannot raise the count
 *   - execution stays restricted to the service role
 */

const migration = readFileSync(
  new URL(
    "../supabase/migrations/20261121160000_failed_payment_recovery.sql",
    import.meta.url,
  ),
  "utf8",
);

const issuanceStart = migration.indexOf(
  "CREATE OR REPLACE FUNCTION public.record_attempt_issuance",
);
const rejectionStart = migration.indexOf(
  "CREATE OR REPLACE FUNCTION public.record_attempt_rejection",
);

assert.ok(issuanceStart >= 0, "issuance function must exist");
assert.ok(rejectionStart > issuanceStart, "rejection function must follow");

const issuance = migration.slice(issuanceStart, rejectionStart);
const rejection = migration.slice(rejectionStart);

test("both RPCs run with SECURITY INVOKER", () => {
  const invokerClauses = migration.match(/SECURITY INVOKER/g) ?? [];

  assert.equal(invokerClauses.length, 2);
  assert.doesNotMatch(migration, /SECURITY DEFINER/i);
});

test("issuance accepts pending and failed requests only", () => {
  assert.match(issuance, /status NOT IN \('pending', 'failed'\)/);
});

test("issuance never writes the rejection count or request status", () => {
  assert.doesNotMatch(issuance, /SET\s+rejection_count/i);
  assert.doesNotMatch(issuance, /UPDATE public\.payment_requests/i);
});

test("issuance keeps expiry and the outstanding-attempt rate limit", () => {
  assert.match(
    issuance,
    /IF p_expires_at IS NULL OR p_expires_at <= NOW\(\) THEN/,
  );
  assert.match(issuance, /IF v_attempt_count >= 5 THEN/);
  assert.match(issuance, /AND consumed_at IS NULL/);
  assert.match(issuance, /AND invalidated_at IS NULL/);
  assert.match(issuance, /AND result = 'pending'/);
  assert.match(issuance, /AND expires_at > NOW\(\)/);
  assert.match(issuance, /AND issued_at >= NOW\(\) - INTERVAL '24 hours'/);
});

test("a non-pending rejection invalidates the attempt without counting it", () => {
  assert.match(
    rejection,
    /IF v_request\.status IS DISTINCT FROM 'pending' THEN/,
  );
  assert.match(
    rejection,
    /IF v_attempt\.consumed_at IS NULL\s+AND v_attempt\.invalidated_at IS NULL THEN/,
  );
  assert.match(rejection, /SET invalidated_at = NOW\(\)/);
  assert.match(rejection, /'recorded', false/);
  assert.match(rejection, /'rejection_count', v_request\.rejection_count/);
});

test("the non-pending guard runs before the only rejection-count increment", () => {
  const guardIndex = rejection.indexOf(
    "IF v_request.status IS DISTINCT FROM 'pending' THEN",
  );
  const increment = "rejection_count = rejection_count + 1";
  const incrementIndex = rejection.indexOf(increment);

  assert.ok(guardIndex >= 0);
  assert.ok(incrementIndex > guardIndex, "guard must precede the increment");
  assert.equal(
    rejection.split(increment).length - 1,
    1,
    "rejection count must be incremented in exactly one place",
  );
  assert.match(
    rejection,
    /SET rejection_count = rejection_count \+ 1\s+WHERE id = v_request\.id\s+AND status = 'pending'/,
  );
});

test("rejection keeps single-use, invalidation and expiry guards", () => {
  assert.match(rejection, /IF v_attempt\.consumed_at IS NOT NULL THEN/);
  assert.match(rejection, /IF v_attempt\.invalidated_at IS NOT NULL THEN/);
  assert.match(rejection, /IF v_attempt\.expires_at <= NOW\(\) THEN/);

  const consumeUpdates = rejection.match(/SET consumed_at = NOW\(\)/g) ?? [];
  assert.equal(consumeUpdates.length, 1);
});

test("the migration cannot mark a request paid or reset rejection history", () => {
  assert.doesNotMatch(migration, /SET\s+status\s*=\s*'paid'/i);
  assert.doesNotMatch(migration, /SET\s+rejection_count\s*=\s*0/i);
  assert.doesNotMatch(migration, /SET\s+status\s*=\s*'expired'/i);
  assert.doesNotMatch(migration, /SET\s+status\s*=\s*'cancelled'/i);
  assert.match(
    migration,
    /SET status = 'failed'\s+WHERE id = v_request\.id\s+AND status = 'pending'/,
  );
});

test("attempt execution stays restricted to the service role", () => {
  for (const functionName of [
    "record_attempt_issuance",
    "record_attempt_rejection",
  ]) {
    const escaped = functionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    for (const role of ["PUBLIC", "anon", "authenticated"]) {
      assert.match(
        migration,
        new RegExp(
          `REVOKE ALL ON FUNCTION public\\.${escaped}\\([\\s\\S]*?\\) FROM ${role};`,
        ),
      );
    }

    assert.match(
      migration,
      new RegExp(
        `GRANT EXECUTE ON FUNCTION public\\.${escaped}\\([\\s\\S]*?\\) TO service_role;`,
      ),
    );
  }
});
