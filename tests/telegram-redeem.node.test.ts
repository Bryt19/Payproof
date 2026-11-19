import assert from "node:assert/strict";
import test from "node:test";

// ---------------------------------------------------------------------------
// Stage 4.3A Step 2: Telegram Token Redemption — Mock-based Test Audit
//
// NOTE: This test file audits the public.redeem_telegram_token() PostgreSQL function
// semantics using an in-memory mock client. These are MOCK UNIT TESTS, distinct
// from live PostgreSQL integration tests that connect to a running Supabase instance.
//
// Source of truth: The live PostgreSQL function retrieved via pg_get_functiondef()
// and defined in supabase/migrations/20261117090000_telegram_link_redemption.sql.
//
// LIVE FUNCTION EXECUTION ORDER:
//   1. Validate inputs and lookup token row (FOR UPDATE) → invalid_token if not found
//   2. Check revocation → revoked_token (comes BEFORE consumption in live function)
//   3. Check consumption:
//      - Same redeemed_telegram_user_id + redeemed_telegram_chat_id → already_redeemed
//      - Different identity → token_already_used
//   4. Check expiry → expired_token
//   5. Check active merchant link (merchant_wallet_address) → merchant_already_linked
//   6. Check active Telegram user link (telegram_user_id to different merchant) → telegram_already_linked
//   7. Atomic consume token + insert link into telegram_links
//   8. On unique constraint violation during insert → rollback token update and return conflict
//   9. On success → linked
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// In-Memory Stores
// ---------------------------------------------------------------------------

interface TokenRecord {
  consumed_at: string | null;
  revoked_at: string | null;
  redeemed_telegram_user_id: number | null;
  redeemed_telegram_chat_id: number | null;
  merchant_wallet_address: string;
  expires_at: string;
}

interface LinkRecord {
  merchant_wallet_address: string;
  telegram_user_id: number;
  telegram_chat_id: number;
  telegram_username: string | null;
  unlinked_at: string | null;
}

const tokenStore: Map<string, TokenRecord> = new Map();
const linkStore: Map<string, LinkRecord> = new Map();

/**
 * Resets all in-memory mock state to prevent test state leakage.
 */
function resetMockState(): void {
  tokenStore.clear();
  linkStore.clear();
}

test.beforeEach(() => {
  resetMockState();
});

test.afterEach(() => {
  resetMockState();
});

// ---------------------------------------------------------------------------
// Store Helpers
// ---------------------------------------------------------------------------

function insertToken(
  hash: string,
  init?: {
    consumed_at?: string | null;
    revoked_at?: string | null;
    redeemed_telegram_user_id?: number | null;
    redeemed_telegram_chat_id?: number | null;
    merchant_wallet_address?: string;
    expires_at?: string;
  },
): void {
  tokenStore.set(hash, {
    consumed_at: init?.consumed_at ?? null,
    revoked_at: init?.revoked_at ?? null,
    redeemed_telegram_user_id: init?.redeemed_telegram_user_id ?? null,
    redeemed_telegram_chat_id: init?.redeemed_telegram_chat_id ?? null,
    merchant_wallet_address:
      init?.merchant_wallet_address ?? "DefaultMerchantWallet11111111111111111111",
    expires_at:
      init?.expires_at ??
      new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
  });
}

function insertLink(link: {
  merchant_wallet_address: string;
  telegram_user_id: number;
  telegram_chat_id: number;
  telegram_username?: string | null;
  unlinked_at?: string | null;
}): void {
  const key = `${link.telegram_user_id}:${link.telegram_chat_id}:${link.merchant_wallet_address}:${Date.now()}:${Math.random()}`;
  linkStore.set(key, {
    merchant_wallet_address: link.merchant_wallet_address,
    telegram_user_id: link.telegram_user_id,
    telegram_chat_id: link.telegram_chat_id,
    telegram_username: link.telegram_username ?? null,
    unlinked_at: link.unlinked_at ?? null,
  });
}

// ---------------------------------------------------------------------------
// Mock Supabase Client
// ---------------------------------------------------------------------------

export type RedeemStatus =
  | "linked"
  | "already_redeemed"
  | "token_already_used"
  | "invalid_token"
  | "expired_token"
  | "revoked_token"
  | "merchant_already_linked"
  | "telegram_already_linked"
  | "conflict"
  | "invalid_input";

interface MockRpcArgs {
  p_token_hash: string;
  p_telegram_user_id: number;
  p_telegram_chat_id: number;
  p_telegram_username: string | null;
}

interface MockRpcResult {
  data: {
    status: RedeemStatus;
    detail: string;
  };
  error: null;
}

function createMockSupabase(options?: { simulateUniqueViolation?: boolean }) {
  let simulateUniqueViolation = options?.simulateUniqueViolation ?? false;

  function setSimulateUniqueViolation(value: boolean): void {
    simulateUniqueViolation = value;
  }

  function from() {
    return {
      insert: function (payload: any) {
        const hash = payload.token_hash || payload._token_hash;
        if (hash && !tokenStore.has(hash)) {
          insertToken(hash, {
            consumed_at: payload.consumed_at,
            revoked_at: payload.revoked_at,
            redeemed_telegram_user_id: payload.redeemed_telegram_user_id,
            redeemed_telegram_chat_id: payload.redeemed_telegram_chat_id,
            merchant_wallet_address: payload.merchant_wallet_address,
            expires_at: payload.expires_at,
          });
        }
        return {
          select: function () {
            return {
              single: function () {
                return {
                  token_hash: hash || "inserted-hash",
                  merchant_wallet_address:
                    payload?.merchant_wallet_address ??
                    "DefaultMerchantWallet11111111111111111111",
                  expires_at: new Date(
                    Date.now() + 1000 * 60 * 60 * 24,
                  ).toISOString(),
                };
              },
            };
          },
        };
      },
      select() {
        return {
          single() {
            return null;
          },
        };
      },
      single() {
        return null;
      },
    };
  }

  async function rpc(
    _rpcName: string,
    args: MockRpcArgs,
  ): Promise<MockRpcResult> {
    const {
      p_token_hash,
      p_telegram_user_id,
      p_telegram_chat_id,
      p_telegram_username,
    } = args;

    // Check for negative or zero Telegram IDs (database constraint telegram_links_chat_id_positive)
    if (p_telegram_user_id <= 0 || p_telegram_chat_id <= 0) {
      return {
        data: {
          status: "invalid_input",
          detail: "Telegram user ID and chat ID must be positive integers",
        },
        error: null,
      };
    }

    // --- Step 1: Token lookup ---
    const tokenRow = tokenStore.get(p_token_hash);
    if (!tokenRow) {
      return {
        data: { status: "invalid_token", detail: "Unknown token hash" },
        error: null,
      };
    }

    const merchantAddress = tokenRow.merchant_wallet_address;

    // --- Step 2: Revocation check (comes BEFORE consumption in live function) ---
    if (tokenRow.revoked_at !== null) {
      return {
        data: { status: "revoked_token", detail: "Token has been revoked" },
        error: null,
      };
    }

    // --- Step 3: Consumption check ---
    if (tokenRow.consumed_at !== null) {
      const sameIdentity =
        tokenRow.redeemed_telegram_user_id === p_telegram_user_id &&
        tokenRow.redeemed_telegram_chat_id === p_telegram_chat_id;

      if (sameIdentity) {
        return {
          data: {
            status: "already_redeemed",
            detail: "This Telegram account is already linked",
          },
          error: null,
        };
      } else {
        return {
          data: {
            status: "token_already_used",
            detail: "Token has already been consumed",
          },
          error: null,
        };
      }
    }

    // --- Step 4: Expiry check ---
    if (new Date(tokenRow.expires_at) < new Date()) {
      return {
        data: { status: "expired_token", detail: "Token has expired" },
        error: null,
      };
    }

    // --- Step 5: Check active merchant link ---
    // Uses the token's specific merchant wallet address (not a hardcoded global)
    let merchantHasActiveLink = false;
    for (const [, link] of linkStore.entries()) {
      if (
        link.merchant_wallet_address === merchantAddress &&
        link.unlinked_at === null
      ) {
        merchantHasActiveLink = true;
        break;
      }
    }
    if (merchantHasActiveLink) {
      return {
        data: {
          status: "merchant_already_linked",
          detail: "Merchant already has an active Telegram link",
        },
        error: null,
      };
    }

    // --- Step 6: Check Telegram user already linked to different merchant ---
    let userLinkedToDifferentMerchant = false;
    for (const [, link] of linkStore.entries()) {
      if (
        link.telegram_user_id === p_telegram_user_id &&
        link.unlinked_at === null &&
        link.merchant_wallet_address !== merchantAddress
      ) {
        userLinkedToDifferentMerchant = true;
        break;
      }
    }
    if (userLinkedToDifferentMerchant) {
      return {
        data: {
          status: "telegram_already_linked",
          detail: "Telegram user is already linked to a different merchant",
        },
        error: null,
      };
    }

    // --- Step 7: Atomic consumption + link creation (with unique violation rollback) ---
    const prevConsumedAt = tokenRow.consumed_at;
    const prevUserId = tokenRow.redeemed_telegram_user_id;
    const prevChatId = tokenRow.redeemed_telegram_chat_id;

    // Tentatively consume the token
    tokenRow.consumed_at = new Date().toISOString();
    tokenRow.redeemed_telegram_user_id = p_telegram_user_id;
    tokenRow.redeemed_telegram_chat_id = p_telegram_chat_id;

    // Simulate unique constraint violation during insert (race condition / concurrency)
    if (simulateUniqueViolation) {
      // Live function exception block: roll back token consumption
      tokenRow.consumed_at = prevConsumedAt;
      tokenRow.redeemed_telegram_user_id = prevUserId;
      tokenRow.redeemed_telegram_chat_id = prevChatId;
      return {
        data: {
          status: "conflict",
          detail: "Concurrent redemption detected - please retry",
        },
        error: null,
      };
    }

    // Insert active link
    const linkKey = `${p_telegram_user_id}:${p_telegram_chat_id}:${merchantAddress}:${Date.now()}:${Math.random()}`;
    linkStore.set(linkKey, {
      merchant_wallet_address: merchantAddress,
      telegram_user_id: p_telegram_user_id,
      telegram_chat_id: p_telegram_chat_id,
      telegram_username: p_telegram_username,
      unlinked_at: null,
    });

    return {
      data: {
        status: "linked",
        detail: "Token redeemed and link created successfully",
      },
      error: null,
    };
  }

  return {
    from,
    rpc,
    setSimulateUniqueViolation,
  };
}

// ---------------------------------------------------------------------------
// TEST SCENARIOS (A through K)
// Each scenario uses unique merchant addresses, token hashes, and Telegram IDs
// to guarantee test isolation and prevent cross-scenario state pollution.
// ---------------------------------------------------------------------------

test("A. Successful redemption", async () => {
  resetMockState();
  const supabase = createMockSupabase();

  const merchantA = "MerchantWallet_ScenarioA_111111111111111111";
  const hashA = "hash-a-telegram-redeem-token-001";
  const userIdA = 10000001;
  const chatIdA = 20000001;

  insertToken(hashA, {
    consumed_at: null,
    revoked_at: null,
    redeemed_telegram_user_id: null,
    redeemed_telegram_chat_id: null,
    merchant_wallet_address: merchantA,
    expires_at: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
  });

  const result = await supabase.rpc("redeem_telegram_token", {
    p_token_hash: hashA,
    p_telegram_user_id: userIdA,
    p_telegram_chat_id: chatIdA,
    p_telegram_username: "userA",
  });

  assert.ok(result.data);
  assert.equal(result.data.status, "linked");
  assert.ok(!result.error);

  const storedToken = tokenStore.get(hashA);
  assert.ok(storedToken);
  assert.notEqual(storedToken.consumed_at, null);
  assert.equal(storedToken.redeemed_telegram_user_id, userIdA);
  assert.equal(storedToken.redeemed_telegram_chat_id, chatIdA);

  const activeLinks = Array.from(linkStore.values()).filter(
    (l) => l.merchant_wallet_address === merchantA && l.unlinked_at === null,
  );
  assert.equal(activeLinks.length, 1);
  assert.equal(activeLinks[0].telegram_user_id, userIdA);
});

test("B. Idempotent redemption (same identity after first redemption)", async () => {
  resetMockState();
  const supabase = createMockSupabase();

  const merchantB = "MerchantWallet_ScenarioB_222222222222222222";
  const hashB = "hash-b-telegram-redeem-token-001";
  const userIdB = 10000002;
  const chatIdB = 20000002;

  // First redemption: token starts unconsumed
  insertToken(hashB, {
    consumed_at: null,
    revoked_at: null,
    redeemed_telegram_user_id: null,
    redeemed_telegram_chat_id: null,
    merchant_wallet_address: merchantB,
    expires_at: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
  });

  // Step 1: First redemption succeeds
  const firstResult = await supabase.rpc("redeem_telegram_token", {
    p_token_hash: hashB,
    p_telegram_user_id: userIdB,
    p_telegram_chat_id: chatIdB,
    p_telegram_username: "userB",
  });
  assert.equal(firstResult.data.status, "linked");

  // Step 2: Retry with that exact token and same Telegram identity
  const secondResult = await supabase.rpc("redeem_telegram_token", {
    p_token_hash: hashB,
    p_telegram_user_id: userIdB,
    p_telegram_chat_id: chatIdB,
    p_telegram_username: "userB",
  });

  // Per live function: consumption check detects same identity → already_redeemed
  assert.equal(secondResult.data.status, "already_redeemed");
  assert.ok(!secondResult.error);

  // Check that no duplicate link was created
  const activeLinks = Array.from(linkStore.values()).filter(
    (l) => l.merchant_wallet_address === merchantB && l.unlinked_at === null,
  );
  assert.equal(activeLinks.length, 1, "no duplicate link should be created");
});

test("C. Different identity attempting to reuse a consumed token", async () => {
  resetMockState();
  const supabase = createMockSupabase();

  const merchantC = "MerchantWallet_ScenarioC_333333333333333333";
  const hashC = "hash-c-telegram-redeem-token-001";
  const originalUser = 10000003;
  const originalChat = 20000003;

  insertToken(hashC, {
    consumed_at: new Date().toISOString(),
    revoked_at: null,
    redeemed_telegram_user_id: originalUser,
    redeemed_telegram_chat_id: originalChat,
    merchant_wallet_address: merchantC,
    expires_at: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
  });

  // Different user ID attempts to use the consumed token
  const firstResult = await supabase.rpc("redeem_telegram_token", {
    p_token_hash: hashC,
    p_telegram_user_id: 99999999,
    p_telegram_chat_id: originalChat,
    p_telegram_username: "intruder1",
  });
  assert.equal(firstResult.data.status, "token_already_used");

  // Another different identity also gets token_already_used
  const secondResult = await supabase.rpc("redeem_telegram_token", {
    p_token_hash: hashC,
    p_telegram_user_id: 88888888,
    p_telegram_chat_id: 88888888,
    p_telegram_username: "intruder2",
  });
  assert.equal(secondResult.data.status, "token_already_used");
  assert.ok(!secondResult.error);
});

test("D. Unknown token", async () => {
  resetMockState();
  const supabase = createMockSupabase();

  const result = await supabase.rpc("redeem_telegram_token", {
    p_token_hash: "hash-d-unknown-token-001",
    p_telegram_user_id: 10000004,
    p_telegram_chat_id: 20000004,
    p_telegram_username: "userD",
  });

  assert.equal(result.data.status, "invalid_token");
  assert.ok(!result.error);
});

test("E. Expired token", async () => {
  resetMockState();
  const supabase = createMockSupabase();

  const merchantE = "MerchantWallet_ScenarioE_555555555555555555";
  const hashE = "hash-e-expired-token-001";

  insertToken(hashE, {
    consumed_at: null,
    revoked_at: null,
    redeemed_telegram_user_id: null,
    redeemed_telegram_chat_id: null,
    merchant_wallet_address: merchantE,
    expires_at: new Date(Date.now() - 1000 * 60 * 15).toISOString(), // 15 min ago
  });

  const result = await supabase.rpc("redeem_telegram_token", {
    p_token_hash: hashE,
    p_telegram_user_id: 10000005,
    p_telegram_chat_id: 20000005,
    p_telegram_username: "userE",
  });

  assert.equal(result.data.status, "expired_token");
  assert.ok(!result.error);
});

test("F. Revoked token", async () => {
  resetMockState();
  const supabase = createMockSupabase();

  const merchantF = "MerchantWallet_ScenarioF_666666666666666666";
  const hashF = "hash-f-revoked-token-001";

  insertToken(hashF, {
    consumed_at: null,
    revoked_at: new Date().toISOString(),
    redeemed_telegram_user_id: null,
    redeemed_telegram_chat_id: null,
    merchant_wallet_address: merchantF,
    expires_at: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
  });

  const result = await supabase.rpc("redeem_telegram_token", {
    p_token_hash: hashF,
    p_telegram_user_id: 10000006,
    p_telegram_chat_id: 20000006,
    p_telegram_username: "userF",
  });

  assert.equal(result.data.status, "revoked_token");
  assert.ok(!result.error);

  const tr = tokenStore.get(hashF);
  assert.ok(tr);
  assert.equal(tr.consumed_at, null, "revoked token must not be consumed");
});

test("G. Merchant already linked", async () => {
  resetMockState();
  const supabase = createMockSupabase();

  const merchantG = "MerchantWallet_ScenarioG_777777777777777777";
  const existingUserId = 10000071;
  const existingChatId = 20000071;

  // 1. Create an active link for the exact merchant wallet address associated with the test token
  insertLink({
    merchant_wallet_address: merchantG,
    telegram_user_id: existingUserId,
    telegram_chat_id: existingChatId,
    telegram_username: "existing_linked_user",
    unlinked_at: null,
  });

  // 2. Prepare another valid, unconsumed token for that exact merchant wallet address
  const newHashG = "hash-g-second-token-001";
  insertToken(newHashG, {
    consumed_at: null,
    revoked_at: null,
    redeemed_telegram_user_id: null,
    redeemed_telegram_chat_id: null,
    merchant_wallet_address: merchantG,
    expires_at: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
  });

  // 3. Attempt redemption with this new token
  const result = await supabase.rpc("redeem_telegram_token", {
    p_token_hash: newHashG,
    p_telegram_user_id: 10000072,
    p_telegram_chat_id: 20000072,
    p_telegram_username: "new_user",
  });

  // Expect merchant_already_linked per live function Step 5
  assert.equal(result.data.status, "merchant_already_linked");
  assert.ok(!result.error);

  // Verify the new token remains unconsumed
  const tokenRecord = tokenStore.get(newHashG);
  assert.ok(tokenRecord);
  assert.equal(
    tokenRecord.consumed_at,
    null,
    "token must remain unconsumed when merchant already has an active link",
  );
  assert.equal(tokenRecord.redeemed_telegram_user_id, null);
  assert.equal(tokenRecord.redeemed_telegram_chat_id, null);
});

test("H. Unique constraint conflict (genuine INSERT conflict simulation)", async () => {
  resetMockState();
  const supabase = createMockSupabase();

  const merchantH = "MerchantWallet_ScenarioH_888888888888888888";
  const hashH = "hash-h-conflict-token-001";
  const userIdH = 10000008;
  const chatIdH = 20000008;

  // Set up a valid, unconsumed token
  insertToken(hashH, {
    consumed_at: null,
    revoked_at: null,
    redeemed_telegram_user_id: null,
    redeemed_telegram_chat_id: null,
    merchant_wallet_address: merchantH,
    expires_at: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
  });

  // Make the mock simulate an actual unique constraint violation during insertion
  supabase.setSimulateUniqueViolation(true);

  const result = await supabase.rpc("redeem_telegram_token", {
    p_token_hash: hashH,
    p_telegram_user_id: userIdH,
    p_telegram_chat_id: chatIdH,
    p_telegram_username: "userH",
  });

  // Expect conflict
  assert.equal(result.data.status, "conflict");

  // Verify that the token update is rolled back
  const stored = tokenStore.get(hashH);
  assert.ok(stored);
  assert.equal(
    stored.consumed_at,
    null,
    "token update must be rolled back to unconsumed on conflict",
  );
  assert.equal(
    stored.redeemed_telegram_user_id,
    null,
    "redeemed user ID must be rolled back to NULL",
  );
  assert.equal(
    stored.redeemed_telegram_chat_id,
    null,
    "redeemed chat ID must be rolled back to NULL",
  );

  // Verify no link was created in linkStore
  const createdLinks = Array.from(linkStore.values()).filter(
    (l) => l.merchant_wallet_address === merchantH,
  );
  assert.equal(createdLinks.length, 0, "no link must be created on conflict");
});

test("I. Invalid input - malformed token hash", async () => {
  resetMockState();
  const supabase = createMockSupabase();

  const result = await supabase.rpc("redeem_telegram_token", {
    p_token_hash: "short",
    p_telegram_user_id: 10000009,
    p_telegram_chat_id: 20000009,
    p_telegram_username: "userI",
  });

  assert.equal(result.data.status, "invalid_token");
});

test("I. Invalid input - zero or negative Telegram IDs", async () => {
  resetMockState();
  const supabase = createMockSupabase();

  const merchantI = "MerchantWallet_ScenarioI_999999999999999999";
  const hashI = "hash-i-negative-ids-001";
  insertToken(hashI, {
    consumed_at: null,
    revoked_at: null,
    redeemed_telegram_user_id: null,
    redeemed_telegram_chat_id: null,
    merchant_wallet_address: merchantI,
    expires_at: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
  });

  let result = await supabase.rpc("redeem_telegram_token", {
    p_token_hash: hashI,
    p_telegram_user_id: 0,
    p_telegram_chat_id: 20000009,
    p_telegram_username: "userI",
  });
  assert.notEqual(result.data.status, "linked");

  result = await supabase.rpc("redeem_telegram_token", {
    p_token_hash: hashI,
    p_telegram_user_id: 10000009,
    p_telegram_chat_id: -1,
    p_telegram_username: "userI",
  });
  assert.notEqual(result.data.status, "linked");
});

test("J. Mock concurrency: race between two identities for same token", async () => {
  // NOTE: This test verifies mock-level sequential concurrency semantics.
  // It does NOT claim to verify live PostgreSQL row-level locking or multi-connection transaction isolation.
  resetMockState();
  const supabase = createMockSupabase();

  const merchantJ = "MerchantWallet_ScenarioJ_101010101010101010";
  const hashJ = "hash-j-concurrent-001";
  const winnerUserId = 10000010;
  const winnerChatId = 20000010;
  const loserUserId = 99999999;
  const loserChatId = 88888888;

  // Token starts unconsumed
  insertToken(hashJ, {
    consumed_at: null,
    revoked_at: null,
    redeemed_telegram_user_id: null,
    redeemed_telegram_chat_id: null,
    merchant_wallet_address: merchantJ,
    expires_at: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
  });

  // Competitor 1 acquires lock / first redemption
  const r1 = await supabase.rpc("redeem_telegram_token", {
    p_token_hash: hashJ,
    p_telegram_user_id: winnerUserId,
    p_telegram_chat_id: winnerChatId,
    p_telegram_username: "winner_user",
  });

  // Competitor 2 attempts to redeem the same token
  const r2 = await supabase.rpc("redeem_telegram_token", {
    p_token_hash: hashJ,
    p_telegram_user_id: loserUserId,
    p_telegram_chat_id: loserChatId,
    p_telegram_username: "loser_user",
  });

  // Exactly one redemption must succeed
  assert.equal(r1.data.status, "linked", "first competitor should succeed");
  assert.equal(
    r2.data.status,
    "token_already_used",
    "second competitor should be rejected with token_already_used",
  );

  const successCount = [r1, r2].filter(
    (r) => r.data.status === "linked",
  ).length;
  assert.equal(successCount, 1, "only one redemption should succeed");

  // Check that only one active link is created in linkStore
  const activeLinks = Array.from(linkStore.values()).filter(
    (l) => l.merchant_wallet_address === merchantJ && l.unlinked_at === null,
  );
  assert.equal(
    activeLinks.length,
    1,
    "only one active link should exist for merchant",
  );

  // Check that the losing identity cannot overwrite the winner
  assert.equal(
    activeLinks[0].telegram_user_id,
    winnerUserId,
    "active link must belong to the winner",
  );
  assert.notEqual(
    activeLinks[0].telegram_user_id,
    loserUserId,
    "loser cannot overwrite winner",
  );
});

test("K. Rollback: forced unique constraint violation preserves token", async () => {
  resetMockState();
  const supabase = createMockSupabase();

  const merchantK = "MerchantWallet_ScenarioK_121212121212121212";
  const hashK = "hash-k-conflict-token-001";
  const userIdK = 10000012;
  const chatIdK = 20000012;

  // Use a valid, unconsumed token
  insertToken(hashK, {
    consumed_at: null,
    revoked_at: null,
    redeemed_telegram_user_id: null,
    redeemed_telegram_chat_id: null,
    merchant_wallet_address: merchantK,
    expires_at: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
  });

  // Force insertion to fail with a unique constraint violation
  supabase.setSimulateUniqueViolation(true);

  const result = await supabase.rpc("redeem_telegram_token", {
    p_token_hash: hashK,
    p_telegram_user_id: userIdK,
    p_telegram_chat_id: chatIdK,
    p_telegram_username: "userK",
  });

  // Expect conflict
  assert.equal(result.data.status, "conflict");

  // Verify consumed_at, redeemed_telegram_user_id, and redeemed_telegram_chat_id remain NULL
  const stored = tokenStore.get(hashK);
  assert.ok(stored);
  assert.equal(
    stored.consumed_at,
    null,
    "consumed_at must remain NULL after rollback",
  );
  assert.equal(
    stored.redeemed_telegram_user_id,
    null,
    "redeemed_telegram_user_id must remain NULL after rollback",
  );
  assert.equal(
    stored.redeemed_telegram_chat_id,
    null,
    "redeemed_telegram_chat_id must remain NULL after rollback",
  );

  // Verify no partial link was created
  const links = Array.from(linkStore.values()).filter(
    (l) => l.merchant_wallet_address === merchantK,
  );
  assert.equal(links.length, 0, "no partial link was created in linkStore");
});
