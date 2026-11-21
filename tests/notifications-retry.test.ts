import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { NextRequest } from "next/server";

import { GET, POST } from "../src/app/api/notifications/retry/route";

// ---------------------------------------------------------------------------
// Auth gate
// ---------------------------------------------------------------------------

function request(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest("http://localhost/api/notifications/retry", {
    method: "GET",
    headers,
  });
}

test("retry endpoint returns 500 when CRON_SECRET is not configured", async () => {
  const previous = process.env.CRON_SECRET;
  delete process.env.CRON_SECRET;

  try {
    const response = await GET(request());
    assert.equal(response.status, 500);
  } finally {
    if (previous !== undefined) process.env.CRON_SECRET = previous;
  }
});

test("retry endpoint rejects a missing secret with 401", async () => {
  process.env.CRON_SECRET = "super-secret-value";

  const response = await GET(request());
  assert.equal(response.status, 401);
});

test("retry endpoint rejects a wrong secret of equal length with 401", async () => {
  process.env.CRON_SECRET = "super-secret-value";

  const response = await GET(request({ "x-cron-secret": "wrong-secret-value" }));
  assert.equal(response.status, 401);
});

test("retry endpoint rejects a wrong secret of different length with 401", async () => {
  process.env.CRON_SECRET = "super-secret-value";

  const response = await POST(request({ "x-cron-secret": "short" }));
  assert.equal(response.status, 401);
});

test("an authorized request reaches database configuration and fails closed", async () => {
  process.env.CRON_SECRET = "super-secret-value";
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;

  try {
    const response = await GET(request({ "x-cron-secret": "super-secret-value" }));
    // Auth passed, so the failure is the missing Supabase configuration,
    // which must be reported as an internal error rather than 401/200.
    assert.equal(response.status, 500);
  } finally {
    if (previousUrl !== undefined) process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
    if (previousKey !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
  }
});

// ---------------------------------------------------------------------------
// Budget must never be reset by the scheduled path
// ---------------------------------------------------------------------------

const ROUTE_SOURCE = readFileSync(
  new URL("../src/app/api/notifications/retry/route.ts", import.meta.url),
  "utf8",
);

const RPC_SOURCE = readFileSync(
  new URL(
    "../supabase/migrations/20261119200000_eligible_deliveries_rpc.sql",
    import.meta.url,
  ),
  "utf8",
);

test("the scheduled retry never writes an attempt counter", () => {
  // Only `deliverNotificationToTelegram` may change `attempt`. If the cron
  // route writes it, a retry could reset the shared budget.
  const attemptWrites = ROUTE_SOURCE.match(/attempt\s*:/g) ?? [];
  assert.equal(
    attemptWrites.length,
    0,
    "retry route must not assign attempt; the delivery pipeline owns the budget",
  );
});

test("only the delivery pipeline updates attempts, using a cumulative cap", () => {
  const serverSource = readFileSync(
    new URL("../src/lib/notifications/server.ts", import.meta.url),
    "utf8",
  );

  assert.match(
    serverSource,
    /Math\.min\(\s*\(current\?\.attempt \?\? 0\) \+ input\.result\.attempts,\s*MAX_DELIVERY_ATTEMPTS\s*\)/,
    "outcome recording must accumulate actual requests and cap at the maximum",
  );
});

test("the eligibility RPC only selects failed or pending deliveries with budget left", () => {
  assert.match(RPC_SOURCE, /nd\.attempt\s*<\s*nd\.max_attempts/i);
  assert.match(RPC_SOURCE, /nd\.status\s+in\s*\('failed',\s*'pending'\)/i);
  assert.equal(
    /uncertain/i.test(RPC_SOURCE),
    false,
    "uncertain deliveries must never be eligible for automatic retry",
  );
});

test("the eligibility RPC is definer-only and revoked from clients", () => {
  assert.match(RPC_SOURCE, /security definer/i);
  assert.match(RPC_SOURCE, /set search_path\s*=\s*pg_catalog,\s*public,\s*pg_temp/i);
  assert.match(
    RPC_SOURCE,
    /revoke all on function public\.get_eligible_deliveries\(\)\s*from public, anon, authenticated/is,
  );assert.match(
    RPC_SOURCE,
    /grant execute on function public\.get_eligible_deliveries\(\)\s*to service_role/is,
  );
});
// ---------------------------------------------------------------------------
// Cron authentication
// ---------------------------------------------------------------------------

function makeRequest(authHeader?: string, extraHeaders: Record<string, string> = {}): NextRequest {
  const baseHeaders: Record<string, string> = {
    "content-type": "application/json",
    ...extraHeaders,
  };
  const headers: Record<string, string> = {
    ...baseHeaders,
  };
  if (authHeader) {
    // Support both Vercel Cron Authorization header and x-cron-secret fallback.
    if (authHeader.startsWith("x-cron-secret:")) {
      headers["x-cron-secret"] = authHeader.slice("x-cron-secret:".length);
    } else {
      headers["authorization"] = authHeader;
    }
  }
  return new NextRequest("http://localhost/api/notifications/retry", {
    method: "GET",
    headers,
  });
}


test("retry endpoint accepts valid Bearer authorization", async () => {
  // Test that the endpoint correctly returns 500 when Supabase is not configured.
  // This is expected behavior — the cron route requires both CRON_SECRET and
  // Supabase runtime environment variables.
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.CRON_SECRET = "super-secret";
  try {
    const response = await GET(
      makeRequest("Bearer super-secret")
    );
    // Auth passed, so the failure is the missing Supabase configuration,
    // which must be reported as an internal error rather than 401/200.
    assert.equal(response.status, 500);
  } finally {
    if (previousUrl !== undefined) process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
    if (previousKey !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
  }
});

test("retry endpoint rejects missing authorization", async () => {
  process.env.CRON_SECRET = "super-secret";

  const response = await GET(makeRequest());
  assert.equal(response.status, 401, "missing auth gets 401");
});

test("retry endpoint rejects incorrect secret", async () => {
  process.env.CRON_SECRET = "super-secret";

  const response = await GET(
    makeRequest("Bearer wrong-secret")
  );
  assert.equal(response.status, 401, "incorrect Bearer secret gets 401");
});

test("retry endpoint rejects mismatched-length secret", async () => {
  process.env.CRON_SECRET = "long-secret-value";

  const response = await GET(
    makeRequest("Bearer short")
  );
  assert.equal(response.status, 401, "mismatched-length Bearer secret gets 401");
});

test("retry endpoint retains backward-compatible x-cron-secret auth", async () => {
  // Test that the endpoint correctly returns 500 when Supabase is not configured.
  // This is expected behavior — the cron route requires both CRON_SECRET and
  // Supabase runtime environment variables.
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.CRON_SECRET = "super-secret";
  try {
    const response = await GET(
      makeRequest("x-cron-secret: super-secret")
    );
    // Auth passed, so the failure is the missing Supabase configuration,
    // which must be reported as an internal error rather than 401/200.
    assert.equal(response.status, 500);
  } finally {
    if (previousUrl !== undefined) process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
    if (previousKey !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
  }
});

// ---------------------------------------------------------------------------
// Outcome ownership is enforced inside the UPDATE statement
// ---------------------------------------------------------------------------

test("outcome recording filters the UPDATE by notification_id and claim_id", () => {
  const serverSource = readFileSync(
    new URL("../src/lib/notifications/server.ts", import.meta.url),
    "utf8",
  );

  assert.match(
    serverSource,
    /\.update\(update\)\s*\n\s*\.eq\("notification_id", input\.notificationId\)\s*\n\s*\.eq\("claim_id", input\.claimId\)/,
    "the claim_id predicate must be part of the update, not only a prior read",
  );
  assert.match(
    serverSource,
    /if \(!updatedRows \|\| updatedRows\.length === 0\)/,
    "a zero-row update must be treated as lost ownership",
  );
});
