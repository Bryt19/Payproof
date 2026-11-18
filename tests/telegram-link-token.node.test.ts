import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  ACTIVE_LINK_MESSAGE,
  CONFLICT_MESSAGE,
  LINK_START_PREFIX,
  LINK_TOKEN_BYTES,
  LINK_TOKEN_EXPIRY_SECONDS,
  HASH_CONFLICT_MESSAGE,
  TELEGRAM_BOT_USERNAME,
  UNAVAILABLE_MESSAGE,
  buildTelegramDeepLink,
  generateLinkToken,
  hashLinkToken,
  isTokenHash,
  resolveLinkTokenOutcome,
  type LinkTokenOutcome,
} from "@/lib/telegram/link-token";

// ---------------------------------------------------------------------------
// Stage 4.3B Step 1: Telegram link-token endpoint — unit tests
//
// These tests exercise the real token primitives and RPC-result mapping used by
// POST /api/integrations/telegram/link-token (src/lib/telegram/link-token.ts).
// Generation, hashing, deep-link construction, and the status -> HTTP rules are
// the route's own code, so they are covered directly rather than re-implemented
// here.
//
// Scope note: this file does NOT prove PostgreSQL behaviour. Per-merchant
// serialisation through pg_advisory_xact_lock(), the partial unique index on
// telegram_link_tokens, and true multi-connection concurrency can only be
// verified against a live Postgres instance. Nothing below claims otherwise.
// ---------------------------------------------------------------------------

function assertSuccess(outcome: LinkTokenOutcome): asserts outcome is Extract<
  LinkTokenOutcome,
  { ok: true }
> {
  if (!outcome.ok) {
    assert.fail(`expected success, received ${outcome.status}`);
  }
}

function assertFailure(outcome: LinkTokenOutcome): asserts outcome is Extract<
  LinkTokenOutcome,
  { ok: false }
> {
  if (outcome.ok) {
    assert.fail("expected a failure outcome, received success");
  }
}

function decodeRawToken(rawToken: string): Buffer {
  return Buffer.from(rawToken, "base64url");
}

// ---------------------------------------------------------------------------
// 1-6: token generation
// ---------------------------------------------------------------------------

test("1. generates a raw token from 32 random bytes", () => {
  const { rawToken } = generateLinkToken();

  assert.equal(LINK_TOKEN_BYTES, 32);
  assert.equal(decodeRawToken(rawToken).length, 32);
  // base64url of 32 bytes is 43 characters with no padding.
  assert.equal(rawToken.length, 43);
});

test("2. raw token is base64url-safe and needs no URL escaping", () => {
  const { rawToken } = generateLinkToken();

  assert.match(rawToken, /^[A-Za-z0-9_-]+$/);
  assert.equal(rawToken.includes("+"), false);
  assert.equal(rawToken.includes("/"), false);
  assert.equal(rawToken.includes("="), false);
  assert.equal(encodeURIComponent(rawToken), rawToken);
});

test("3. every call produces a distinct raw token", () => {
  const tokens = new Set<string>();

  for (let i = 0; i < 64; i += 1) {
    tokens.add(generateLinkToken().rawToken);
  }

  assert.equal(tokens.size, 64, "crypto randomness must not repeat tokens");
});

test("4. stored hash is exactly 64 lowercase hexadecimal characters", () => {
  const { tokenHash } = generateLinkToken();

  assert.equal(tokenHash.length, 64);
  assert.match(tokenHash, /^[0-9a-f]{64}$/);
  assert.equal(isTokenHash(tokenHash), true);
});

test("5. hash is SHA-256 of the raw token string", () => {
  const { rawToken, tokenHash } = generateLinkToken();

  // The bot receives the raw token inside the /start payload, so the hash must
  // be reproducible from that string alone.
  const expected = createHash("sha256").update(rawToken, "utf8").digest("hex");

  assert.equal(tokenHash, expected);
  assert.equal(hashLinkToken(rawToken), tokenHash);
});

test("6. hashLinkToken is deterministic and value-dependent", () => {
  const first = generateLinkToken();
  const second = generateLinkToken();

  assert.equal(hashLinkToken(first.rawToken), hashLinkToken(first.rawToken));
  assert.notEqual(hashLinkToken(first.rawToken), hashLinkToken(second.rawToken));
});

// ---------------------------------------------------------------------------
// 7: hash validation
// ---------------------------------------------------------------------------

test("7. isTokenHash rejects malformed hashes", () => {
  const valid = "a".repeat(64);

  assert.equal(isTokenHash(valid), true);
  assert.equal(isTokenHash("A".repeat(64)), false, "uppercase must be rejected");
  assert.equal(isTokenHash("a".repeat(63)), false, "63 chars must be rejected");
  assert.equal(isTokenHash("a".repeat(65)), false, "65 chars must be rejected");
  assert.equal(isTokenHash(`g${"a".repeat(63)}`), false, "non-hex must be rejected");
  assert.equal(isTokenHash(""), false);
  assert.equal(isTokenHash(null), false);
  assert.equal(isTokenHash(undefined), false);
  assert.equal(isTokenHash(123), false);
});

// ---------------------------------------------------------------------------
// 8-9: deep link
// ---------------------------------------------------------------------------

test("8. deep link targets the PayProof bot with the linking payload", () => {
  const { rawToken } = generateLinkToken();
  const deepLink = buildTelegramDeepLink(rawToken);

  assert.equal(
    deepLink,
    `https://t.me/${TELEGRAM_BOT_USERNAME}?start=${LINK_START_PREFIX}${rawToken}`
  );
  assert.equal(deepLink.startsWith("https://t.me/PayProofNotifyBot?start=link_"), true);

  const parsed = new URL(deepLink);
  assert.equal(parsed.hostname, "t.me");
  assert.equal(parsed.pathname, `/${TELEGRAM_BOT_USERNAME}`);
  assert.equal(parsed.searchParams.get("start"), `link_${rawToken}`);
});

test("9. deep link round-trips the raw token without escaping", () => {
  const { rawToken } = generateLinkToken();
  const startPayload = new URL(buildTelegramDeepLink(rawToken)).searchParams.get(
    "start"
  );

  assert.ok(startPayload);
  assert.equal(startPayload.slice(LINK_START_PREFIX.length), rawToken);
  assert.equal(startPayload, `link_${rawToken}`);
});

// ---------------------------------------------------------------------------
// 10-14: RPC result mapping
// ---------------------------------------------------------------------------

test("10. success returns 200 with a deep link and database expiry", () => {
  const { rawToken, tokenHash } = generateLinkToken();

  const outcome = resolveLinkTokenOutcome(
    {
      status: "success",
      detail: "Token generated successfully",
      expires_at: "2026-11-17T15:00:00+00:00",
      expires_in_seconds: 900,
    },
    rawToken
  );

  assertSuccess(outcome);
  assert.equal(outcome.status, 200);
  assert.equal(outcome.body.success, true);
  assert.equal(outcome.body.telegramLink, buildTelegramDeepLink(rawToken));
  assert.equal(outcome.body.expiresAt, "2026-11-17T15:00:00.000Z");
  assert.equal(outcome.body.expiresInSeconds, 900);

  // Only the link carries the token; the hash never appears in the response.
  assert.equal(JSON.stringify(outcome.body).includes(tokenHash), false);
});

test("11. success uses the database timestamp, not the local clock", () => {
  const { rawToken } = generateLinkToken();
  const dbExpiry = "2027-03-04T09:12:34.000Z";

  const outcome = resolveLinkTokenOutcome(
    { status: "success", expires_at: dbExpiry, expires_in_seconds: 900 },
    rawToken
  );

  assertSuccess(outcome);
  assert.equal(outcome.body.expiresAt, dbExpiry);
});

test("12. success accepts a Date value for expires_at", () => {
  const { rawToken } = generateLinkToken();
  const dbExpiry = new Date("2026-12-01T10:00:00.000Z");

  const outcome = resolveLinkTokenOutcome(
    { status: "success", expires_at: dbExpiry, expires_in_seconds: 900 },
    rawToken
  );

  assertSuccess(outcome);
  assert.equal(outcome.body.expiresAt, dbExpiry.toISOString());
});

test("13. success without a usable expiry is treated as unavailable", () => {
  const { rawToken } = generateLinkToken();

  for (const expiresAt of [null, undefined, "", "not-a-date"]) {
    const outcome = resolveLinkTokenOutcome(
      { status: "success", expires_at: expiresAt, expires_in_seconds: 900 },
      rawToken
    );

    assertFailure(outcome);
    assert.equal(outcome.status, 503);
    assert.equal(outcome.body.error, UNAVAILABLE_MESSAGE);
  }
});

test("14. missing expires_in_seconds falls back to the 15-minute lifetime", () => {
  const { rawToken } = generateLinkToken();

  const outcome = resolveLinkTokenOutcome(
    { status: "success", expires_at: "2026-11-17T15:00:00.000Z" },
    rawToken
  );

  assertSuccess(outcome);
  assert.equal(outcome.body.expiresInSeconds, LINK_TOKEN_EXPIRY_SECONDS);
  assert.equal(LINK_TOKEN_EXPIRY_SECONDS, 900);
});

// ---------------------------------------------------------------------------
// 15-18: rejected and unexpected results
// ---------------------------------------------------------------------------

test("15. active_link returns 409 without a deep link", () => {
  const { rawToken } = generateLinkToken();

  const outcome = resolveLinkTokenOutcome(
    { status: "active_link", detail: "Merchant already has an active Telegram link" },
    rawToken
  );

  assertFailure(outcome);
  assert.equal(outcome.status, 409);
  assert.equal(outcome.body.error, "Merchant already has an active Telegram link");
  assert.equal("telegramLink" in outcome.body, false);
  assert.equal(outcome.body.error.includes(rawToken), false);

  const fallback = resolveLinkTokenOutcome({ status: "active_link" }, rawToken);
  assertFailure(fallback);
  assert.equal(fallback.status, 409);
  assert.equal(fallback.body.error, ACTIVE_LINK_MESSAGE);
});

test("16. conflict returns 409 without a deep link", () => {
  const { rawToken } = generateLinkToken();

  const outcome = resolveLinkTokenOutcome({ status: "conflict" }, rawToken);

  assertFailure(outcome);
  assert.equal(outcome.status, 409);
  assert.equal(outcome.body.error, CONFLICT_MESSAGE);
  assert.equal("telegramLink" in outcome.body, false);
});

test("17. invalid_request returns a generic 503 without leaking detail", () => {
  const { rawToken } = generateLinkToken();

  const invalid = resolveLinkTokenOutcome(
    { status: "invalid_request", detail: "Token hash must be 64 lowercase hex" },
    rawToken
  );

  assertFailure(invalid);
  assert.equal(invalid.status, 503);
  assert.equal(invalid.body.error, UNAVAILABLE_MESSAGE);
  assert.equal(invalid.body.error.includes("Token hash"), false);
  assert.equal(invalid.body.error.includes(rawToken), false);
});

test("18. null, undefined, and unknown results are handled safely", () => {
  const { rawToken } = generateLinkToken();

  for (const result of [null, undefined, {}, { status: "surprise_status" }]) {
    const outcome = resolveLinkTokenOutcome(result, rawToken);

    assertFailure(outcome);
    assert.equal(outcome.status, 503);
    assert.equal(outcome.body.error, UNAVAILABLE_MESSAGE);
    assert.equal("telegramLink" in outcome.body, false);
  }
});

// ---------------------------------------------------------------------------
// 19: sequential requests (mock-level; not a Postgres concurrency test)
// ---------------------------------------------------------------------------

test("19. sequential requests produce independent tokens and hashes", () => {
  const first = generateLinkToken();
  const second = generateLinkToken();

  assert.notEqual(first.rawToken, second.rawToken);
  assert.notEqual(first.tokenHash, second.tokenHash);

  const firstOutcome = resolveLinkTokenOutcome(
    { status: "success", expires_at: "2026-11-17T15:00:00.000Z", expires_in_seconds: 900 },
    first.rawToken
  );
  const secondOutcome = resolveLinkTokenOutcome(
    { status: "success", expires_at: "2026-11-17T15:00:00.000Z", expires_in_seconds: 900 },
    second.rawToken
  );

  assertSuccess(firstOutcome);
  assertSuccess(secondOutcome);
  assert.notEqual(firstOutcome.body.telegramLink, secondOutcome.body.telegramLink);

  // NOTE: sequential calls only. Advisory-lock serialisation between two real
  // database connections is not exercised here.
});

// ---------------------------------------------------------------------------
// 20-25: status vocabulary returned by the SQL function
// ---------------------------------------------------------------------------

test("20. merchant_already_linked returns 409 with the unlink message", () => {
  const { rawToken } = generateLinkToken();

  const outcome = resolveLinkTokenOutcome(
    { status: "merchant_already_linked", detail: "Merchant already has an active Telegram link" },
    rawToken
  );

  assertFailure(outcome);
  assert.equal(outcome.status, 409);
  assert.equal(outcome.retryable, false);
  assert.equal(outcome.body.error, "Merchant already has an active Telegram link");
  assert.equal("telegramLink" in outcome.body, false);

  const fallback = resolveLinkTokenOutcome({ status: "merchant_already_linked" }, rawToken);
  assertFailure(fallback);
  assert.equal(fallback.status, 409);
  assert.equal(fallback.body.error, ACTIVE_LINK_MESSAGE);
});

test("21. legacy active_link status still maps to 409", () => {
  const { rawToken } = generateLinkToken();

  const outcome = resolveLinkTokenOutcome({ status: "active_link" }, rawToken);

  assertFailure(outcome);
  assert.equal(outcome.status, 409);
  assert.equal(outcome.retryable, false);
  assert.equal(outcome.body.error, ACTIVE_LINK_MESSAGE);
});

test("22. hash_conflict is a retryable 409", () => {
  const { rawToken } = generateLinkToken();

  const outcome = resolveLinkTokenOutcome({ status: "hash_conflict" }, rawToken);

  assertFailure(outcome);
  assert.equal(outcome.status, 409);
  assert.equal(outcome.retryable, true);
  assert.equal(outcome.body.error, HASH_CONFLICT_MESSAGE);
  assert.equal("telegramLink" in outcome.body, false);
});

test("23. conflict is a retryable 409", () => {
  const { rawToken } = generateLinkToken();

  const outcome = resolveLinkTokenOutcome({ status: "conflict" }, rawToken);

  assertFailure(outcome);
  assert.equal(outcome.status, 409);
  assert.equal(outcome.retryable, true);
  assert.equal(outcome.body.error, CONFLICT_MESSAGE);
});

test("24. invalid merchant/hash statuses stay generic and non-retryable", () => {
  const { rawToken } = generateLinkToken();

  for (const status of ["invalid_merchant", "invalid_token_hash", "invalid_request"]) {
    const outcome = resolveLinkTokenOutcome(
      { status, detail: "Token hash must be a 64-character lowercase hexadecimal string" },
      rawToken
    );

    assertFailure(outcome);
    assert.equal(outcome.status, 503);
    assert.equal(outcome.retryable, false);
    assert.equal(outcome.body.error, UNAVAILABLE_MESSAGE);
    assert.equal(outcome.body.error.includes("64-character"), false);
  }
});

test("25. retrying after hash_conflict yields a usable deep link with the fresh token", () => {
  // The route regenerates a token on a retryable result; this mirrors that
  // sequence without a database connection.
  const first = generateLinkToken();
  const firstOutcome = resolveLinkTokenOutcome({ status: "hash_conflict" }, first.rawToken);

  assertFailure(firstOutcome);
  assert.equal(firstOutcome.retryable, true);

  const second = generateLinkToken();
  const secondOutcome = resolveLinkTokenOutcome(
    {
      status: "success",
      expires_at: "2026-11-17T15:00:00.000Z",
      expires_in_seconds: 900,
    },
    second.rawToken
  );

  assertSuccess(secondOutcome);
  assert.equal(secondOutcome.body.telegramLink, buildTelegramDeepLink(second.rawToken));
  assert.equal(secondOutcome.body.telegramLink.includes(first.rawToken), false);
});
