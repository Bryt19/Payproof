import assert from "node:assert/strict";
import { generateKeyPairSync, randomBytes, sign } from "node:crypto";
import test from "node:test";
import {
  buildChallengeMessage,
  createMerchantAuthService,
  hashSessionToken,
} from "../src/lib/auth/merchant-auth-service.ts";
import {
  isMerchantConsolePath,
  MERCHANT_CONSOLE_ROUTES,
} from "../src/lib/auth/console-routes.ts";
import { validateMerchantSessionToken } from "../src/lib/auth/session-validation.ts";

// ---------------------------------------------------------------------------
// Deterministic test environment
// ---------------------------------------------------------------------------

const TEST_DOMAIN = "payproof.invalid";

type AuthEnvironment = {
  domain: string;
  supabase: MockSupabaseClient;
  cookieMaxAgeSeconds: number;
  sessionMaxAgeSeconds: number;
  cookieName: string;
};

function testEnvironment(supabase: MockSupabaseClient): AuthEnvironment {
  return {
    domain: TEST_DOMAIN,
    supabase,
    cookieMaxAgeSeconds: 10,
    sessionMaxAgeSeconds: 10,
    cookieName: "pp_merchant_session",
  };
}

// ---------------------------------------------------------------------------
// Mock Supabase surface the service actually uses.
// ---------------------------------------------------------------------------

type MerchantAuthRow = {
  id: string;
  challenge_nonce: string;
  domain: string;
  issued_at: string;
  expires_at: string;
  wallet_address: string;
  session_token: string | null;
  session_expires_at: string | null;
  created_at: string;
  deleted_at: string | null;
};

type RowPredicate = (row: MerchantAuthRow) => boolean;

type QueryResult = { data: MerchantAuthRow | null; error: object | null };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MockSupabaseClient = any;

function createMockSupabase(): MockSupabaseClient {
  const rows: MerchantAuthRow[] = [];
  let sequence = 0;

  function firstMatch(predicates: RowPredicate[]): MerchantAuthRow | null {
    return (
      rows.find(
        (row) => row.deleted_at === null && predicates.every((predicate) => predicate(row)),
      ) ?? null
    );
  }

  /**
   * A PostgREST-style builder: every filter returns the same builder, and the
   * query only runs when `single()` is awaited.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function builder(predicates: RowPredicate[], onSingle: () => QueryResult): any {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const query: any = {
      eq(column: keyof MerchantAuthRow, value: unknown) {
        predicates.push((row) => row[column] === value);
        return query;
      },
      is(column: keyof MerchantAuthRow, value: unknown) {
        predicates.push((row) => row[column] === value);
        return query;
      },
      gte(column: keyof MerchantAuthRow, value: string) {
        predicates.push(
          (row) =>
            new Date(row[column] as string).getTime() >= new Date(value).getTime(),
        );
        return query;
      },
      select() {
        return query;
      },
      single() {
        return onSingle();
      },
      // Like PostgREST, the query also runs when the builder itself is awaited.
      then(resolve: (value: QueryResult) => void) {
        resolve(onSingle());
      },
    };
    return query;
  }

  return {
    from() {
      return {
        insert(payload: Record<string, unknown>) {
          const row: MerchantAuthRow = {
            id: `ch-${++sequence}`,
            challenge_nonce: payload.challenge_nonce as string,
            domain: payload.domain as string,
            issued_at: payload.issued_at as string,
            expires_at: payload.expires_at as string,
            wallet_address: payload.wallet_address as string,
            session_token: null,
            session_expires_at: null,
            created_at: new Date().toISOString(),
            deleted_at: null,
          };
          rows.push(row);
          const result = { data: row, error: null };
          return { select: () => ({ single: () => result }) };
        },
        select() {
          const predicates: RowPredicate[] = [];
          return builder(predicates, () => {
            const row = firstMatch(predicates);
            return { data: row, error: row ? null : {} };
          });
        },
        update(payload: Record<string, unknown>) {
          const predicates: RowPredicate[] = [];
          return builder(predicates, () => {
            const row = firstMatch(predicates);
            if (!row) return { data: null, error: {} };
            Object.assign(row, payload);
            return { data: row, error: null };
          });
        },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Crypto helpers for tests
// ---------------------------------------------------------------------------

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

// A Solana address is the base58 encoding of the 32-byte Ed25519 public key.
function base58Encode(bytes: Uint8Array): string {
  let value = 0n;
  for (const byte of bytes) {
    value = value * 256n + BigInt(byte);
  }

  let encoded = "";
  while (value > 0n) {
    encoded = BASE58_ALPHABET[Number(value % 58n)] + encoded;
    value /= 58n;
  }

  for (const byte of bytes) {
    if (byte !== 0) break;
    encoded = `1${encoded}`;
  }

  return encoded;
}

function createWallet() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const spkiDer = publicKey.export({ type: "spki", format: "der" });
  const rawPublicKey = new Uint8Array(spkiDer.subarray(spkiDer.length - 32));
  return {
    address: base58Encode(rawPublicKey),
    rawPublicKey,
    privateKey,
  };
}

function signedChallengeMessage({ nonce, domain }: { nonce: string; domain: string }) {
  // Deliberately use the production builder: if the server layout changes, the
  // tests sign whatever the server now verifies instead of a stale copy.
  return buildChallengeMessage(domain, nonce);
}

function signChallenge({
  privateKey,
  nonce,
  domain,
}: {
  privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"];
  nonce: string;
  domain: string;
}) {
  const message = signedChallengeMessage({ nonce, domain });
  // The service verifies a hex-encoded Ed25519 signature over the raw message.
  return sign(null, Buffer.from(message, "utf8"), privateKey).toString("hex");
}

function isChallengeError(value: unknown): value is Error {
  return value instanceof Error;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("hashSessionToken is deterministic and never returns the raw token", () => {
  const raw = randomBytes(24).toString("base64url");
  const hash = hashSessionToken(raw);

  assert.ok(typeof hash === "string");
  assert.ok(hash.length > 0);
  assert.notEqual(hash.toLowerCase(), raw.toLowerCase());
  assert.equal(hashSessionToken(raw), hash);
});

test("a valid wallet signature creates a session and returns the raw token", async () => {
  const owner = createWallet();
  const supabase = createMockSupabase();
  const service = await createMerchantAuthService(testEnvironment(supabase));

  const createResult = await service.createChallenge(owner.address);
  if (isChallengeError(createResult)) {
    assert.fail(`createChallenge returned an error: ${createResult.message}`);
  }

  const challenge = supabase.from().select().single();
  assert.ok(challenge.data);

  const signature = signChallenge({
    privateKey: owner.privateKey,
    nonce: challenge.data.challenge_nonce,
    domain: TEST_DOMAIN,
  });

  const result = await service.consumeChallenge(
    challenge.data.challenge_nonce,
    TEST_DOMAIN,
    owner.address,
    signature,
  );

  assert.equal(result.ok, true);
  assert.equal(result.walletAddress, owner.address);
  assert.ok(typeof result.sessionToken === "string");
  assert.ok(result.sessionToken.length > 0);

  const stored = supabase.from().select().single();
  assert.ok(stored.data);
  assert.equal(stored.data.session_token, hashSessionToken(result.sessionToken));
  assert.notEqual(stored.data.session_token, result.sessionToken);
});

test("a challenge cannot be redeemed using a different wallet's signature", async () => {
  const owner = createWallet();
  const attacker = createWallet();
  const supabase = createMockSupabase();
  const service = await createMerchantAuthService(testEnvironment(supabase));

  const createResult = await service.createChallenge(owner.address);
  if (isChallengeError(createResult)) {
    assert.fail(`createChallenge returned an error: ${createResult.message}`);
  }

  const challenge = supabase.from().select().single();
  assert.ok(challenge.data);

  const attackerSignature = signChallenge({
    privateKey: attacker.privateKey,
    nonce: challenge.data.challenge_nonce,
    domain: TEST_DOMAIN,
  });

  const wrongAddressResult = await service.consumeChallenge(
    challenge.data.challenge_nonce,
    TEST_DOMAIN,
    attacker.address,
    attackerSignature,
  );
  assert.equal(wrongAddressResult.ok, false);
  assert.equal(wrongAddressResult.kind, "invalid-signature");

  const wrongSignatureResult = await service.consumeChallenge(
    challenge.data.challenge_nonce,
    TEST_DOMAIN,
    owner.address,
    attackerSignature,
  );
  assert.equal(wrongSignatureResult.ok, false);
  assert.equal(wrongSignatureResult.kind, "invalid-signature");

  const stillUnused = supabase.from().select().single();
  assert.ok(stillUnused.data);
  assert.equal(stillUnused.data.session_token, null);
});

test("a challenge cannot be redeemed twice", async () => {
  const owner = createWallet();
  const supabase = createMockSupabase();
  const service = await createMerchantAuthService(testEnvironment(supabase));

  const createResult = await service.createChallenge(owner.address);
  if (isChallengeError(createResult)) {
    assert.fail(`createChallenge returned an error: ${createResult.message}`);
  }

  const challenge = supabase.from().select().single();
  assert.ok(challenge.data);

  const signature = signChallenge({
    privateKey: owner.privateKey,
    nonce: challenge.data.challenge_nonce,
    domain: TEST_DOMAIN,
  });

  const first = await service.consumeChallenge(
    challenge.data.challenge_nonce,
    TEST_DOMAIN,
    owner.address,
    signature,
  );
  assert.equal(first.ok, true);

  const second = await service.consumeChallenge(
    challenge.data.challenge_nonce,
    TEST_DOMAIN,
    owner.address,
    signature,
  );
  assert.equal(second.ok, false);

  const stored = supabase.from().select().single();
  assert.ok(stored.data);
  assert.equal(stored.data.session_token, hashSessionToken(first.sessionToken));
});

test("an expired challenge is rejected", async () => {
  const owner = createWallet();
  const supabase = createMockSupabase();
  const service = await createMerchantAuthService(testEnvironment(supabase));

  const createResult = await service.createChallenge(owner.address);
  if (isChallengeError(createResult)) {
    assert.fail(`createChallenge returned an error: ${createResult.message}`);
  }

  const challenge = supabase.from().select().single();
  assert.ok(challenge.data);
  challenge.data.expires_at = new Date(Date.now() - 1000).toISOString();

  const signature = signChallenge({
    privateKey: owner.privateKey,
    nonce: challenge.data.challenge_nonce,
    domain: TEST_DOMAIN,
  });

  const result = await service.consumeChallenge(
    challenge.data.challenge_nonce,
    TEST_DOMAIN,
    owner.address,
    signature,
  );

  assert.equal(result.ok, false);

  const stored = supabase.from().select().single();
  assert.ok(stored.data);
  assert.equal(stored.data.session_token, null);
});

test("wallet address binding rejects a signature from the correct key for the wrong address", async () => {
  const owner = createWallet();
  const other = createWallet();
  const supabase = createMockSupabase();
  const service = await createMerchantAuthService(testEnvironment(supabase));

  const createResult = await service.createChallenge(owner.address);
  if (isChallengeError(createResult)) {
    assert.fail(`createChallenge returned an error: ${createResult.message}`);
  }

  const challenge = supabase.from().select().single();
  assert.ok(challenge.data);

  const signature = signChallenge({
    privateKey: owner.privateKey,
    nonce: challenge.data.challenge_nonce,
    domain: TEST_DOMAIN,
  });

  const result = await service.consumeChallenge(
    challenge.data.challenge_nonce,
    TEST_DOMAIN,
    other.address,
    signature,
  );

  assert.equal(result.ok, false);
  assert.equal(result.kind, "invalid-signature");
});

test("a valid raw cookie token can be validated through its hash", async () => {
  const owner = createWallet();
  const supabase = createMockSupabase();
  const service = await createMerchantAuthService(testEnvironment(supabase));

  const createResult = await service.createChallenge(owner.address);
  if (isChallengeError(createResult)) {
    assert.fail(`createChallenge returned an error: ${createResult.message}`);
  }

  const challenge = supabase.from().select().single();
  assert.ok(challenge.data);

  const signature = signChallenge({
    privateKey: owner.privateKey,
    nonce: challenge.data.challenge_nonce,
    domain: TEST_DOMAIN,
  });

  const verified = await service.consumeChallenge(
    challenge.data.challenge_nonce,
    TEST_DOMAIN,
    owner.address,
    signature,
  );
  assert.equal(verified.ok, true);

  const validated = await service.validateSession(verified.sessionToken);
  assert.equal(validated.ok, true);
  assert.equal(validated.walletAddress, owner.address);

  const tampered = `${verified.sessionToken.slice(0, -4)}aaaa`;
  const tamperedResult = await service.validateSession(tampered);
  assert.equal(tamperedResult.ok, false);
  assert.equal(tamperedResult.kind, "unknown");
});

test("an expired session is rejected", async () => {
  const owner = createWallet();
  const supabase = createMockSupabase();
  const service = await createMerchantAuthService(testEnvironment(supabase));

  const createResult = await service.createChallenge(owner.address);
  if (isChallengeError(createResult)) {
    assert.fail(`createChallenge returned an error: ${createResult.message}`);
  }

  const challenge = supabase.from().select().single();
  assert.ok(challenge.data);

  const signature = signChallenge({
    privateKey: owner.privateKey,
    nonce: challenge.data.challenge_nonce,
    domain: TEST_DOMAIN,
  });

  const verified = await service.consumeChallenge(
    challenge.data.challenge_nonce,
    TEST_DOMAIN,
    owner.address,
    signature,
  );
  assert.equal(verified.ok, true);

  challenge.data.session_expires_at = new Date(Date.now() - 1000).toISOString();

  const result = await service.validateSession(verified.sessionToken);
  assert.equal(result.ok, false);
  assert.equal(result.kind, "expired");
});

test("a logged-out session is rejected", async () => {
  const owner = createWallet();
  const supabase = createMockSupabase();
  const service = await createMerchantAuthService(testEnvironment(supabase));

  const createResult = await service.createChallenge(owner.address);
  if (isChallengeError(createResult)) {
    assert.fail(`createChallenge returned an error: ${createResult.message}`);
  }

  const challenge = supabase.from().select().single();
  assert.ok(challenge.data);

  const signature = signChallenge({
    privateKey: owner.privateKey,
    nonce: challenge.data.challenge_nonce,
    domain: TEST_DOMAIN,
  });

  const verified = await service.consumeChallenge(
    challenge.data.challenge_nonce,
    TEST_DOMAIN,
    owner.address,
    signature,
  );
  assert.equal(verified.ok, true);

  await service.invalidateSession(verified.sessionToken);

  const invalidated = await service.validateSession(verified.sessionToken);
  assert.equal(invalidated.ok, false);
  assert.equal(invalidated.kind, "unknown");

  // Deleted rows are filtered out of queries, so read the captured row itself.
  assert.notEqual(challenge.data.deleted_at, null);
});

// ---------------------------------------------------------------------------
// Message layout, route protection and the shared session validator
// ---------------------------------------------------------------------------

test("the message a wallet signs is exactly three lines: PayProof, domain, nonce", () => {
  const nonce = "abc-DEF_123";
  const message = buildChallengeMessage(TEST_DOMAIN, nonce);

  assert.equal(message, `PayProof\n${TEST_DOMAIN}\n${nonce}`);
  assert.equal(message.split("\n").length, 3);
  assert.equal(message.endsWith("\n"), false);
  assert.equal(
    Buffer.from(message, "utf8").toString("utf8"),
    message,
    "the message must be stable UTF-8",
  );
});

test("a signature over a different domain is rejected even for the right key", async () => {
  const owner = createWallet();
  const supabase = createMockSupabase();
  const service = await createMerchantAuthService(testEnvironment(supabase));

  const createResult = await service.createChallenge(owner.address);
  if (isChallengeError(createResult)) {
    assert.fail(`createChallenge returned an error: ${createResult.message}`);
  }

  const challenge = supabase.from().select().single();
  assert.ok(challenge.data);

  const message = signedChallengeMessage({
    nonce: challenge.data.challenge_nonce,
    domain: "attacker.invalid",
  });
  const signature = sign(null, Buffer.from(message, "utf8"), owner.privateKey).toString("hex");

  const result = await service.consumeChallenge(
    challenge.data.challenge_nonce,
    TEST_DOMAIN,
    owner.address,
    signature,
  );

  assert.equal(result.ok, false);
  assert.equal(result.kind, "invalid-signature");

  const stored = supabase.from().select().single();
  assert.ok(stored.data);
  assert.equal(stored.data.session_token, null);
});

test("validateMerchantSessionToken distinguishes missing, unknown, expired and valid sessions", async () => {
  const owner = createWallet();
  const supabase = createMockSupabase();
  const environment = testEnvironment(supabase);
  const service = await createMerchantAuthService(environment);

  const missing = await validateMerchantSessionToken(undefined, environment);
  assert.equal(missing.authenticated, false);
  assert.equal(missing.authenticated === false && missing.reason, "no-session");

  const createResult = await service.createChallenge(owner.address);
  if (isChallengeError(createResult)) {
    assert.fail(`createChallenge returned an error: ${createResult.message}`);
  }

  const challenge = supabase.from().select().single();
  assert.ok(challenge.data);

  const verified = await service.consumeChallenge(
    challenge.data.challenge_nonce,
    TEST_DOMAIN,
    owner.address,
    signChallenge({
      privateKey: owner.privateKey,
      nonce: challenge.data.challenge_nonce,
      domain: TEST_DOMAIN,
    }),
  );
  if (!verified.ok) {
    assert.fail(`consumeChallenge rejected a valid signature: ${verified.message}`);
  }

  const valid = await validateMerchantSessionToken(verified.sessionToken, environment);
  assert.equal(valid.authenticated, true);
  assert.equal(valid.authenticated === true && valid.walletAddress, owner.address);

  const unknown = await validateMerchantSessionToken("not-a-real-token", environment);
  assert.equal(unknown.authenticated, false);
  assert.equal(unknown.authenticated === false && unknown.reason, "invalid-session");

  challenge.data.session_expires_at = new Date(Date.now() - 1000).toISOString();

  const expired = await validateMerchantSessionToken(verified.sessionToken, environment);
  assert.equal(expired.authenticated, false);
  assert.equal(expired.authenticated === false && expired.reason, "expired-session");
});

test("every merchant console route is protected and public routes are not", () => {
  const expected = [
    "/dashboard",
    "/payments",
    "/payment-requests",
    "/invoices",
    "/notifications",
    "/ai-assistant",
    "/settings",
  ];

  assert.deepEqual([...MERCHANT_CONSOLE_ROUTES].sort(), [...expected].sort());

  for (const route of expected) {
    assert.equal(isMerchantConsolePath(route), true, `${route} must be protected`);
    assert.equal(isMerchantConsolePath(`${route}/nested`), true, `${route}/nested must be protected`);
  }

  for (const publicPath of [
    "/",
    "/login",
    "/pay/some-reference",
    "/privacy",
    "/terms",
    "/disclaimer",
    "/api/dashboard",
    "/payments-report",
    "/setting",
  ]) {
    assert.equal(isMerchantConsolePath(publicPath), false, `${publicPath} must stay public`);
  }
});
