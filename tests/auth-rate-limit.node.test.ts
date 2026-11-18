import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  CHALLENGE_GLOBAL_RULES,
  CHALLENGE_IP_RULES,
  CHALLENGE_UNKNOWN_IP_RULES,
  CHALLENGE_WALLET_RULES,
  RATE_LIMIT_RETENTION_HOURS,
  VERIFY_IP_RULES,
  VERIFY_UNKNOWN_IP_RULES,
  VERIFY_WALLET_RULES,
} from "../src/lib/auth/rate-limit-policy.ts";
import {
  UNKNOWN_CLIENT_KEY,
  checkClientRateLimit,
  checkWalletRateLimit,
  hashRateLimitKey,
  rateLimitResponseInit,
  resolveClientIp,
  type RateLimitOutcome,
  type RateLimitStore,
} from "../src/lib/auth/rate-limit.ts";

// Deterministic pepper so hashing never depends on the developer's .env.
process.env.AUTH_RATE_LIMIT_PEPPER = "test-pepper";
delete process.env.VERCEL;

const WALLET_A = "BuaQzqFZtx25WBC6GSzStMrjYfD8x4jix2q3RdtaMQYy";
const WALLET_B = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function headers(entries: Record<string, string> = {}) {
  const values = new Map(
    Object.entries(entries).map(([name, value]) => [name.toLowerCase(), value]),
  );
  return { get: (name: string) => values.get(name.toLowerCase()) ?? null };
}

type Clock = { now: number };

/**
 * In-memory equivalent of the SQL function: the increment and the decision
 * happen with no await between them, which is the atomicity guarantee the
 * database statement provides in production.
 */
function createMemoryStore(clock: Clock, options: { fail?: boolean } = {}) {
  const counters = new Map<string, number>();

  const store: RateLimitStore = {
    consume: async (input) => {
      if (options.fail) throw new Error("counter store unavailable");

      const windowStart =
        Math.floor(clock.now / input.windowSeconds) * input.windowSeconds;
      const key = `${input.bucket}|${input.keyHash}|${windowStart}`;
      const hits = Math.min((counters.get(key) ?? 0) + 1, input.limit + 1);
      counters.set(key, hits);

      if (hits <= input.limit) return { allowed: true };

      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, windowStart + input.windowSeconds - clock.now),
      };
    },
  };

  return { store, counters };
}

function countAllowed(outcomes: readonly RateLimitOutcome[]): number {
  return outcomes.filter((outcome) => outcome.ok).length;
}

function countLimited(outcomes: readonly RateLimitOutcome[]): number {
  return outcomes.filter(
    (outcome) => !outcome.ok && outcome.kind === "limited",
  ).length;
}

async function withVercel<T>(run: () => Promise<T>): Promise<T> {
  process.env.VERCEL = "1";
  try {
    return await run();
  } finally {
    delete process.env.VERCEL;
  }
}

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

test("the approved rate-limit policy is pinned", () => {
  const short = (rules: readonly { limit: number; windowSeconds: number }[]) =>
    rules[0];

  assert.deepEqual(short(CHALLENGE_IP_RULES), { bucket: "challenge:ip", limit: 15, windowSeconds: 300 });
  assert.deepEqual(CHALLENGE_IP_RULES[1], { bucket: "challenge:ip", limit: 60, windowSeconds: 3600 });
  assert.deepEqual(short(CHALLENGE_UNKNOWN_IP_RULES), { bucket: "challenge:unknown-ip", limit: 10, windowSeconds: 300 });
  assert.deepEqual(CHALLENGE_UNKNOWN_IP_RULES[1], { bucket: "challenge:unknown-ip", limit: 40, windowSeconds: 3600 });
  assert.deepEqual(short(CHALLENGE_GLOBAL_RULES), { bucket: "challenge:global", limit: 1000, windowSeconds: 300 });
  assert.deepEqual(short(CHALLENGE_WALLET_RULES), { bucket: "challenge:wallet", limit: 5, windowSeconds: 300 });
  assert.deepEqual(CHALLENGE_WALLET_RULES[1], { bucket: "challenge:wallet", limit: 15, windowSeconds: 3600 });
  assert.deepEqual(short(VERIFY_IP_RULES), { bucket: "verify:ip", limit: 20, windowSeconds: 300 });
  assert.deepEqual(short(VERIFY_UNKNOWN_IP_RULES), { bucket: "verify:unknown-ip", limit: 10, windowSeconds: 300 });
  assert.deepEqual(short(VERIFY_WALLET_RULES), { bucket: "verify:wallet", limit: 10, windowSeconds: 300 });
  assert.equal(RATE_LIMIT_RETENTION_HOURS, 24);
});

// ---------------------------------------------------------------------------
// Below, at and above the limit
// ---------------------------------------------------------------------------

test("requests below the limit are allowed", async () => {
  const clock: Clock = { now: 1_700_000_000_000 };
  const { store } = createMemoryStore(clock);

  for (let index = 0; index < 4; index += 1) {
    const outcome = await checkWalletRateLimit("challenge", WALLET_A, store);
    assert.deepEqual(outcome, { ok: true });
  }
});

test("the request after the limit is rejected with a Retry-After inside the window", async () => {
  const clock: Clock = { now: 1_700_000_000_000 };
  const { store } = createMemoryStore(clock);

  for (let index = 0; index < 5; index += 1) {
    assert.deepEqual(await checkWalletRateLimit("challenge", WALLET_A, store), { ok: true });
  }

  const blocked = await checkWalletRateLimit("challenge", WALLET_A, store);
  assert.equal(blocked.ok, false);
  if (blocked.ok) return;

  assert.equal(blocked.kind, "limited");
  assert.ok(blocked.retryAfterSeconds > 0);
  assert.ok(blocked.retryAfterSeconds <= 300);

  const init = rateLimitResponseInit(blocked);
  assert.equal(init.status, 429);
  assert.equal(init.headers["retry-after"], String(blocked.retryAfterSeconds));
  assert.equal(init.headers["cache-control"], "no-store");
});

// ---------------------------------------------------------------------------
// Concurrency
// ---------------------------------------------------------------------------

test("concurrent requests cannot exceed the limit", async () => {
  const clock: Clock = { now: 1_700_000_000_000 };
  const { store } = createMemoryStore(clock);

  const outcomes = await Promise.all(
    Array.from({ length: 50 }, () =>
      checkWalletRateLimit("challenge", WALLET_A, store),
    ),
  );

  assert.equal(countAllowed(outcomes), 5);
  assert.equal(countLimited(outcomes), 45);
});

// ---------------------------------------------------------------------------
// Independent identities
// ---------------------------------------------------------------------------

test("different wallets have independent buckets", async () => {
  const clock: Clock = { now: 1_700_000_000_000 };
  const { store } = createMemoryStore(clock);

  for (let index = 0; index < 5; index += 1) {
    await checkWalletRateLimit("challenge", WALLET_A, store);
  }

  assert.equal((await checkWalletRateLimit("challenge", WALLET_A, store)).ok, false);
  assert.deepEqual(await checkWalletRateLimit("challenge", WALLET_B, store), { ok: true });
});

test("different trusted IPs have independent buckets", async () => {
  await withVercel(async () => {
    const clock: Clock = { now: 1_700_000_000_000 };
    const { store } = createMemoryStore(clock);

    const ipA = headers({ "x-vercel-forwarded-for": "203.0.113.10" });
    const ipB = headers({ "x-vercel-forwarded-for": "203.0.113.11" });

    for (let index = 0; index < 15; index += 1) {
      assert.deepEqual(await checkClientRateLimit("challenge", ipA, store), { ok: true });
    }

    assert.equal((await checkClientRateLimit("challenge", ipA, store)).ok, false);
    assert.deepEqual(await checkClientRateLimit("challenge", ipB, store), { ok: true });
  });
});

test("rotating wallet addresses cannot bypass the IP limit", async () => {
  await withVercel(async () => {
    const clock: Clock = { now: 1_700_000_000_000 };
    const { store } = createMemoryStore(clock);
    const sameIp = headers({ "x-vercel-forwarded-for": "198.51.100.7" });

    const outcomes: RateLimitOutcome[] = [];
    for (let index = 0; index < 20; index += 1) {
      const client = await checkClientRateLimit("challenge", sameIp, store);
      outcomes.push(client);
      if (!client.ok) continue;

      await checkWalletRateLimit("challenge", `wallet-${index}`, store);
    }

    assert.equal(countAllowed(outcomes), 15);
    assert.equal(countLimited(outcomes), 5);
  });
});

test("rotating IP addresses cannot bypass the wallet limit", async () => {
  await withVercel(async () => {
    const clock: Clock = { now: 1_700_000_000_000 };
    const { store } = createMemoryStore(clock);

    const outcomes: RateLimitOutcome[] = [];
    for (let index = 0; index < 20; index += 1) {
      const client = await checkClientRateLimit(
        "challenge",
        headers({ "x-vercel-forwarded-for": `198.51.100.${index + 1}` }),
        store,
      );
      assert.deepEqual(client, { ok: true });

      outcomes.push(await checkWalletRateLimit("challenge", WALLET_A, store));
    }

    assert.equal(countAllowed(outcomes), 5);
    assert.equal(countLimited(outcomes), 15);
  });
});

test("global challenge limits cannot be bypassed by rotating wallets or IPs", async () => {
  await withVercel(async () => {
    const clock: Clock = { now: 1_700_000_000_000 };
    const { store } = createMemoryStore(clock);

    // Every request gets a distinct valid IP and a distinct wallet, so only the
    // constant-keyed global bucket can stop the flood.
    const outcomes: RateLimitOutcome[] = [];
    for (let index = 0; index < 1001; index += 1) {
      const ip = `10.0.${Math.floor(index / 256)}.${index % 256}`;
      outcomes.push(
        await checkClientRateLimit(
          "challenge",
          headers({ "x-vercel-forwarded-for": ip }),
          store,
        ),
      );
    }

    assert.equal(countAllowed(outcomes), 1000);
    assert.equal(countLimited(outcomes), 1);
  });
});

// ---------------------------------------------------------------------------
// Untrusted / spoofed IP headers
// ---------------------------------------------------------------------------

test("IP headers are ignored when the request is not behind the trusted proxy", async () => {
  const spoofed = headers({
    "x-vercel-forwarded-for": "203.0.113.99",
    "x-forwarded-for": "203.0.113.99",
    "x-real-ip": "203.0.113.99",
  });

  assert.equal(resolveClientIp(spoofed), null);

  const clock: Clock = { now: 1_700_000_000_000 };
  const { store } = createMemoryStore(clock);

  // Every spoofed value lands in the one shared bucket, so rotating the header
  // cannot buy extra attempts.
  const outcomes: RateLimitOutcome[] = [];
  for (let index = 0; index < 11; index += 1) {
    outcomes.push(
      await checkClientRateLimit(
        "challenge",
        headers({
          "x-forwarded-for": `198.51.100.${index + 1}`,
          "x-vercel-forwarded-for": `203.0.113.${index + 1}`,
        }),
        store,
      ),
    );
  }

  assert.equal(countAllowed(outcomes), 10);
  assert.equal(countLimited(outcomes), 1);
});

test("a missing IP header uses the shared unknown bucket", async () => {
  assert.equal(resolveClientIp(headers()), null);

  const clock: Clock = { now: 1_700_000_000_000 };
  const { store } = createMemoryStore(clock);

  const outcomes: RateLimitOutcome[] = [];
  for (let index = 0; index < 11; index += 1) {
    outcomes.push(await checkClientRateLimit("challenge", headers(), store));
  }

  assert.equal(countAllowed(outcomes), 10);
  assert.equal(countLimited(outcomes), 1);

  // A single shared bucket rather than one per caller: the counter map holds
  // exactly one short-window entry for the unknown key.
  assert.equal(UNKNOWN_CLIENT_KEY, "unknown-ip");
});

test("malformed trusted IP values fall back to the unknown bucket", async () => {
  await withVercel(async () => {
    const clock: Clock = { now: 1_700_000_000_000 };
    const { store } = createMemoryStore(clock);

    assert.equal(resolveClientIp(headers({ "x-vercel-forwarded-for": "not-an-ip" })), null);

    const outcomes: RateLimitOutcome[] = [];
    for (let index = 0; index < 11; index += 1) {
      outcomes.push(
        await checkClientRateLimit(
          "challenge",
          headers({ "x-vercel-forwarded-for": "definitely-not-an-ip" }),
          store,
        ),
      );
    }

    assert.equal(countAllowed(outcomes), 10);
    assert.equal(countLimited(outcomes), 1);
  });
});

test("trusted IP parsing accepts only validated addresses", async () => {
  await withVercel(async () => {
    assert.equal(
      resolveClientIp(headers({ "x-vercel-forwarded-for": "203.0.113.5" })),
      "203.0.113.5",
    );
    assert.equal(
      resolveClientIp(headers({ "x-vercel-forwarded-for": "203.0.113.5, 70.41.3.18" })),
      "203.0.113.5",
    );
    assert.equal(
      resolveClientIp(headers({ "x-forwarded-for": "2001:DB8::1, 70.41.3.18" })),
      "2001:db8::1",
    );
    assert.equal(resolveClientIp(headers({ "x-forwarded-for": "unknown" })), null);
  });
});

// ---------------------------------------------------------------------------
// Invalid wallet addresses
// ---------------------------------------------------------------------------

test("invalid or missing wallet addresses still consume the client bucket", async () => {
  await withVercel(async () => {
    const clock: Clock = { now: 1_700_000_000_000 };
    const { store } = createMemoryStore(clock);
    const ip = headers({ "x-vercel-forwarded-for": "192.0.2.44" });

    // The route calls the client check before parsing, so a request with no
    // usable wallet address is still counted here.
    const outcomes: RateLimitOutcome[] = [];
    for (let index = 0; index < 16; index += 1) {
      outcomes.push(await checkClientRateLimit("challenge", ip, store));
    }

    assert.equal(countAllowed(outcomes), 15);
    assert.equal(countLimited(outcomes), 1);
  });
});

// ---------------------------------------------------------------------------
// Storage failures (fail closed)
// ---------------------------------------------------------------------------

test("counter-store failures fail closed and reveal no detail", async () => {
  const clock: Clock = { now: 1_700_000_000_000 };
  const { store } = createMemoryStore(clock, { fail: true });

  const client = await checkClientRateLimit("challenge", headers(), store);
  assert.equal(client.ok, false);
  if (!client.ok) assert.equal(client.kind, "unavailable");

  const wallet = await checkWalletRateLimit("challenge", WALLET_A, store);
  assert.equal(wallet.ok, false);
  if (!wallet.ok) assert.equal(wallet.kind, "unavailable");

  const verifyClient = await checkClientRateLimit("verify", headers(), store);
  assert.equal(verifyClient.ok, false);

  const verifyWallet = await checkWalletRateLimit("verify", WALLET_A, store);
  assert.equal(verifyWallet.ok, false);

  if (client.ok) return;
  const init = rateLimitResponseInit(client);
  assert.equal(init.status, 503);

  const serialized = JSON.stringify(init);
  assert.doesNotMatch(serialized, /challenge|wallet|ip:|pepper|service.role/i);
  assert.doesNotMatch(serialized, new RegExp(WALLET_A));
});

test("a missing pepper fails closed rather than allowing requests", async () => {
  const savedPepper = process.env.AUTH_RATE_LIMIT_PEPPER;
  const savedServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  delete process.env.AUTH_RATE_LIMIT_PEPPER;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;

  try {
    const clock: Clock = { now: 1_700_000_000_000 };
    const { store } = createMemoryStore(clock);
    const outcome = await checkClientRateLimit("challenge", headers(), store);

    assert.equal(outcome.ok, false);
    if (!outcome.ok) assert.equal(outcome.kind, "unavailable");
  } finally {
    process.env.AUTH_RATE_LIMIT_PEPPER = savedPepper ?? "test-pepper";
    if (savedServiceKey !== undefined) {
      process.env.SUPABASE_SERVICE_ROLE_KEY = savedServiceKey;
    }
  }
});

// ---------------------------------------------------------------------------
// Recovery
// ---------------------------------------------------------------------------

test("a merchant can retry after the short window elapses", async () => {
  const clock: Clock = { now: 1_700_000_000_000 };
  const { store } = createMemoryStore(clock);

  for (let index = 0; index < 5; index += 1) {
    await checkWalletRateLimit("challenge", WALLET_A, store);
  }

  assert.equal((await checkWalletRateLimit("challenge", WALLET_A, store)).ok, false);

  clock.now += 301;
  assert.deepEqual(await checkWalletRateLimit("challenge", WALLET_A, store), { ok: true });
});

test("the hourly backstop keeps counting after the short window resets", async () => {
  const clock: Clock = { now: 1_700_000_000_000 };
  const { store } = createMemoryStore(clock);

  // 15 challenges across three short windows: the per-hour rule (15) is exhausted.
  for (let window = 0; window < 3; window += 1) {
    for (let index = 0; index < 5; index += 1) {
      await checkWalletRateLimit("challenge", WALLET_A, store);
    }
    clock.now += 301;
  }

  const blocked = await checkWalletRateLimit("challenge", WALLET_A, store);
  assert.equal(blocked.ok, false);
  if (!blocked.ok && blocked.kind === "limited") {
    assert.ok(blocked.retryAfterSeconds > 0);
    assert.ok(blocked.retryAfterSeconds <= 3600);
  }
});

// ---------------------------------------------------------------------------
// Response hygiene
// ---------------------------------------------------------------------------

test("429 responses expose no bucket, IP, wallet or limit detail", async () => {
  const clock: Clock = { now: 1_700_000_000_000 };
  const { store } = createMemoryStore(clock);

  for (let index = 0; index < 6; index += 1) {
    await checkWalletRateLimit("challenge", WALLET_A, store);
  }

  const outcome = await checkWalletRateLimit("challenge", WALLET_A, store);
  if (outcome.ok) assert.fail("expected the request to be limited");

  const init = rateLimitResponseInit(outcome);
  const serialized = JSON.stringify(init);

  assert.equal(init.status, 429);
  assert.equal(Object.keys(init.body).join(","), "error");
  assert.doesNotMatch(serialized, new RegExp(WALLET_A));
  assert.doesNotMatch(serialized, /challenge|wallet|ip:|bucket|limit|supabase|postgres/i);
  assert.match(init.headers["retry-after"] ?? "", /^\d+$/);
});

test("rate-limit keys are peppered digests, not raw identities", () => {
  const ipKey = hashRateLimitKey("challenge:ip", "ip:203.0.113.10");

  assert.match(ipKey, /^[0-9a-f]{64}$/);
  assert.doesNotMatch(ipKey, /203\.0\.113\.10/);
  assert.equal(ipKey, hashRateLimitKey("challenge:ip", "ip:203.0.113.10"));
  assert.notEqual(ipKey, hashRateLimitKey("challenge:ip", "ip:203.0.113.11"));
  assert.notEqual(ipKey, hashRateLimitKey("challenge:wallet", "ip:203.0.113.10"));

  const savedPepper = process.env.AUTH_RATE_LIMIT_PEPPER;
  try {
    process.env.AUTH_RATE_LIMIT_PEPPER = "different-pepper";
    assert.notEqual(ipKey, hashRateLimitKey("challenge:ip", "ip:203.0.113.10"));
  } finally {
    process.env.AUTH_RATE_LIMIT_PEPPER = savedPepper ?? "test-pepper";
  }
});

// ---------------------------------------------------------------------------
// Retention / cleanup deliverable
// ---------------------------------------------------------------------------

test("the migration bounds retention and keeps counters atomic and private", () => {
  const sql = readFileSync(
    new URL("../supabase/migrations/20261116120000_auth_rate_limits.sql", import.meta.url),
    "utf8",
  );

  // Atomic increment-and-decide in one statement, against the qualified table.
  // The clamp is applied before incrementing so a pre-existing very large
  // counter value cannot overflow the integer.
  assert.match(sql, /on conflict \(bucket, key_hash, window_start\)/);
  assert.match(sql, /set hits = least\(counters\.hits, p_limit\) \+ 1/);
  assert.match(sql, /returning counters\.hits into v_hits/);

  // SECURITY DEFINER hardening: pinned search_path and a bounded p_limit.
  assert.match(sql, /security definer/);
  assert.match(sql, /set search_path = pg_catalog, public, pg_temp/);
  assert.match(sql, /p_limit > 1000000/);

  // Bounded 24-hour retention, not an unbounded sweep.
  assert.match(sql, /interval '24 hours'/);
  assert.match(sql, /limit p_max_rows/);
  assert.match(sql, /p_max_rows < 1\s+or p_max_rows > 100000/);
  assert.doesNotMatch(sql, /truncate\s+table/i);
  assert.doesNotMatch(sql, /delete\s+from\s+(public\.)?auth_rate_limits\s*;/i);

  // Browser roles cannot touch the counters, and the deny policy is restrictive
  // so a permissive policy elsewhere cannot OR past it. It is never dropped.
  assert.match(sql, /alter table public\.auth_rate_limits enable row level security/);
  assert.match(sql, /revoke all on table public\.auth_rate_limits from anon/);
  assert.match(sql, /revoke all on table public\.auth_rate_limits from authenticated/);
  assert.match(
    sql,
    /grant select,\s+insert,\s+update,\s+delete\s+on table public\.auth_rate_limits\s+to service_role/,
  );
  assert.match(sql, /as restrictive/);
  assert.match(sql, /p\.polpermissive = false/);
  assert.doesNotMatch(sql, /drop\s+policy/i);

  // Existing-table reconciliation is additive and type-strict.
  assert.match(sql, /alter table public\.auth_rate_limits\s+add constraint auth_rate_limits_pkey/);
  assert.match(sql, /c\.udt_name <> expected\.expected_type/);
  assert.match(sql, /c\.is_nullable <> 'NO'/);
  assert.match(sql, /existing_definition <> spec\.expected_definition/);
  assert.doesNotMatch(sql, /drop\s+table/i);
  assert.doesNotMatch(sql, /drop\s+constraint/i);
  assert.doesNotMatch(sql, /delete\s+from\s+public\.auth_rate_limits\s+where\s+true/i);
});
