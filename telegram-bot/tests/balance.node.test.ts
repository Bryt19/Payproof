import assert from "node:assert/strict";
import test from "node:test";
import { Bot, type Transformer } from "grammy";
import type { Update } from "grammy/types";

import {
  BALANCE_COOLDOWN_TEXT,
  BALANCE_UNAVAILABLE_TEXT,
  MERCHANT_LOOKUP_FAILED_TEXT,
  accountLinkingRequiredText,
  registerHandlers,
  type HandlerDependencies,
} from "../src/handlers.js";
import type { PayProofData } from "../src/lib/payproof.js";
import {
  COINBASE_SOL_USD_URL,
  DEVNET_GENESIS_HASH,
  MAINNET_GENESIS_HASH,
  TESTNET_GENESIS_HASH,
  buildBalanceText,
  fetchBalanceSnapshot,
  formatUsd,
  parseNetworkFromGenesis,
  shortenAddress,
  type BalanceSnapshot,
} from "../src/lib/wallet-balance.js";

// ---------------------------------------------------------------------------
// Harness: a real grammY Bot whose API calls are captured instead of sent.
// ---------------------------------------------------------------------------

type ApiCall = { method: string; payload: Record<string, unknown> };

const BOT_INFO = {
  id: 12345,
  is_bot: true,
  first_name: "PayProof Notify",
  username: "PayProofNotifyBot",
  can_join_groups: true,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
};

const CHAT_ID = 42;
const FROM = { id: 42, is_bot: false, first_name: "Merchant" };
const MERCHANT_WALLET = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const OTHER_MERCHANT_WALLET = "8h7YwLrTQAg8PtEPibhRZfKgWgXKjYFtiys5yqNg8fXW";

const ACTIVE_LINK = {
  merchantAddress: MERCHANT_WALLET,
  telegramUserId: FROM.id,
  telegramChatId: CHAT_ID,
  linkedAt: "2026-11-18T09:30:00.000Z",
};

function fakeData(): PayProofData {
  return {
    getSummary: async () => ({
      ok: true,
      data: {
        verifiedCount: 0,
        verifiedLamports: 0n,
        pendingCount: 0,
        failedCount: 0,
      },
    }),
    getRecentVerified: async () => ({ ok: true, data: [] }),
    getRecentTransactions: async () => ({ ok: true, data: [] }),
    getPending: async () => ({ ok: true, data: [] }),
    getVerifiedReceipt: async () => ({ ok: true, data: null }),
  };
}

function createHarness(deps: HandlerDependencies = {}) {
  const calls: ApiCall[] = [];
  const bot = new Bot("12345:test-token");

  const transformer = (async (
    _prev: unknown,
    method: string,
    payload: unknown,
  ) => {
    calls.push({ method, payload: (payload ?? {}) as Record<string, unknown> });

    let result: unknown = true;
    if (method === "getMe") result = BOT_INFO;
    else if (method === "sendMessage") {
      result = {
        message_id: calls.length,
        date: 0,
        chat: { id: CHAT_ID, type: "private" },
      };
    }
    return { ok: true, result };
  }) as unknown as Transformer;

  bot.api.config.use(transformer);
  registerHandlers(bot, {
    lookupTelegramLink: async () => ({ state: "not_linked" }),
    data: fakeData(),
    ...deps,
  });

  return { bot, calls };
}

async function deliver(bot: Bot, update: Update): Promise<void> {
  await bot.init();
  await bot.handleUpdate(update);
}

function textUpdate(text: string): Update {
  const commandLength = text.startsWith("/") ? text.split(/\s/)[0].length : 0;
  return {
    update_id: 2,
    message: {
      message_id: 20,
      date: 0,
      chat: { id: CHAT_ID, type: "private" },
      from: FROM,
      text,
      ...(commandLength > 0
        ? { entities: [{ type: "bot_command", offset: 0, length: commandLength }] }
        : {}),
    },
  } as unknown as Update;
}

function callbackUpdate(data: string): Update {
  return {
    update_id: 3,
    callback_query: {
      id: "cb-1",
      chat_instance: "ci-1",
      from: FROM,
      data,
      message: {
        message_id: 20,
        date: 0,
        chat: { id: CHAT_ID, type: "private" },
      },
    },
  } as unknown as Update;
}

function callsOf(calls: ApiCall[], method: string): ApiCall[] {
  return calls.filter((call) => call.method === method);
}

function messageText(call: ApiCall): string {
  return typeof call.payload.text === "string" ? call.payload.text : "";
}

function snapshot(overrides: Partial<BalanceSnapshot> = {}): BalanceSnapshot {
  return {
    merchantAddress: MERCHANT_WALLET,
    lamports: 12_458_000_000n,
    network: parseNetworkFromGenesis(DEVNET_GENESIS_HASH),
    usd: null,
    updatedAt: new Date("2026-11-24T12:00:00.000Z"),
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

type FakeRpcOptions = {
  genesis?: string;
  lamports?: number;
  priceAmount?: string;
  priceStatus?: number;
  rpcError?: string;
};

function fakeRpcFetch(options: FakeRpcOptions = {}) {
  const calls: string[] = [];

  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);

    if (url === COINBASE_SOL_USD_URL) {
      if (options.priceStatus && options.priceStatus !== 200) {
        return jsonResponse({}, options.priceStatus);
      }
      return jsonResponse({
        data: { base: "SOL", currency: "USD", amount: options.priceAmount },
      });
    }

    if (options.rpcError) {
      return jsonResponse({
        jsonrpc: "2.0",
        id: 1,
        error: { message: options.rpcError },
      });
    }

    const body = JSON.parse(String(init?.body ?? "{}")) as {
      method?: string;
    };

    if (body.method === "getGenesisHash") {
      return jsonResponse({
        jsonrpc: "2.0",
        id: 1,
        result: options.genesis ?? DEVNET_GENESIS_HASH,
      });
    }

    if (body.method === "getBalance") {
      return jsonResponse({
        jsonrpc: "2.0",
        id: 1,
        result: {
          context: { slot: 1 },
          value: options.lamports ?? 12_458_000_000,
        },
      });
    }

    return jsonResponse({ jsonrpc: "2.0", id: 1, error: { message: "unknown" } });
  }) as typeof fetch;

  return { fetchImpl, calls };
}

// ---------------------------------------------------------------------------
// Formatting and network detection
// ---------------------------------------------------------------------------

test("shortenAddress keeps four leading and four trailing characters", () => {
  assert.equal(shortenAddress(MERCHANT_WALLET), "9xQe...VFin");
  assert.equal(shortenAddress("short"), "short");
});

test("formatUsd renders two decimals with thousands separators", () => {
  assert.equal(formatUsd(1245.8), "$1,245.80");
  assert.equal(formatUsd(0.5), "$0.50");
});

test("genesis hashes map to the expected networks", () => {
  assert.equal(parseNetworkFromGenesis(DEVNET_GENESIS_HASH).id, "devnet");
  assert.equal(parseNetworkFromGenesis(MAINNET_GENESIS_HASH).id, "mainnet-beta");
  assert.equal(parseNetworkFromGenesis(TESTNET_GENESIS_HASH).id, "testnet");
  assert.equal(parseNetworkFromGenesis("unknown-genesis").id, "unknown");
  assert.equal(parseNetworkFromGenesis(MAINNET_GENESIS_HASH).usdAvailable, true);
  assert.equal(parseNetworkFromGenesis(DEVNET_GENESIS_HASH).usdAvailable, false);
});

test("Devnet balance text never presents a USD value", () => {
  const text = buildBalanceText(snapshot());

  assert.match(text, /^PayProof Wallet Balance/);
  assert.match(text, /Balance: 12\.458 SOL/);
  assert.match(text, /Estimated value: Not available on Devnet/);
  assert.match(text, /Wallet: 9xQe\.\.\.VFin/);
  assert.match(text, /Network: Solana Devnet/);
  assert.match(text, /Updated: Just now/);
  assert.match(text, /Devnet SOL has no monetary value/);
  assert.ok(!text.includes("$"), "Devnet text must never contain a dollar value");
});

test("Mainnet balance text shows the estimated USD value", () => {
  const text = buildBalanceText(
    snapshot({
      network: parseNetworkFromGenesis(MAINNET_GENESIS_HASH),
      usd: 1245.8,
    }),
  );

  assert.match(text, /Estimated value: ≈ \$1,245\.80 USD/);
  assert.match(text, /Network: Solana Mainnet/);
  assert.ok(!text.includes("no monetary value"));
});

test("Mainnet price failure keeps the SOL balance and says the estimate is unavailable", () => {
  const text = buildBalanceText(
    snapshot({
      network: parseNetworkFromGenesis(MAINNET_GENESIS_HASH),
      usd: null,
    }),
  );

  assert.match(text, /Balance: 12\.458 SOL/);
  assert.match(text, /Estimated value: Unavailable right now/);
  assert.match(text, /Could not fetch a market price right now/);
  assert.ok(!text.includes("$"));
});

// ---------------------------------------------------------------------------
// RPC + price reading (fake fetch, no network)
// ---------------------------------------------------------------------------

test("Devnet snapshot reads genesis and balance but never calls the price API", async () => {
  const { fetchImpl, calls } = fakeRpcFetch();
  const result = await fetchBalanceSnapshot(MERCHANT_WALLET, { fetchImpl });

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.data.lamports, 12_458_000_000n);
  assert.equal(result.data.network.id, "devnet");
  assert.equal(result.data.usd, null);
  assert.equal(calls.filter((url) => url === COINBASE_SOL_USD_URL).length, 0);
  assert.equal(calls.length, 2, "genesis + balance only");
});

test("Mainnet snapshot multiplies the confirmed balance by the spot price", async () => {
  const { fetchImpl } = fakeRpcFetch({
    genesis: MAINNET_GENESIS_HASH,
    lamports: 2_500_000_000,
    priceAmount: "100",
  });
  const result = await fetchBalanceSnapshot(MERCHANT_WALLET, { fetchImpl });

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.data.network.id, "mainnet-beta");
  assert.equal(result.data.usd, 250);
});

test("an invalid price response yields the balance without a USD estimate", async () => {
  const { fetchImpl } = fakeRpcFetch({
    genesis: MAINNET_GENESIS_HASH,
    priceAmount: "not-a-price",
  });
  const result = await fetchBalanceSnapshot(MERCHANT_WALLET, { fetchImpl });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.usd, null);
});

test("a price outage yields the balance without a USD estimate", async () => {
  const { fetchImpl } = fakeRpcFetch({
    genesis: MAINNET_GENESIS_HASH,
    priceStatus: 503,
  });
  const result = await fetchBalanceSnapshot(MERCHANT_WALLET, { fetchImpl });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.usd, null);
});

test("RPC errors fail closed instead of reporting a zero balance", async () => {
  const { fetchImpl } = fakeRpcFetch({ rpcError: "node unavailable" });
  const result = await fetchBalanceSnapshot(MERCHANT_WALLET, { fetchImpl });

  assert.equal(result.ok, false);
});

test("an invalid wallet address is rejected before any RPC call", async () => {
  const { fetchImpl, calls } = fakeRpcFetch();
  const result = await fetchBalanceSnapshot("not-a-wallet", { fetchImpl });

  assert.equal(result.ok, false);
  assert.equal(calls.length, 0);
});

test("an unrecognised genesis hash reports an unknown network without USD", async () => {
  const { fetchImpl } = fakeRpcFetch({ genesis: "some-other-cluster" });
  const result = await fetchBalanceSnapshot(MERCHANT_WALLET, { fetchImpl });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.network.id, "unknown");
  assert.equal(result.data.usd, null);
});

// ---------------------------------------------------------------------------
// /balance command
// ---------------------------------------------------------------------------

test("/balance replies with the linked merchant's balance and network", async () => {
  let receivedAddress: string | null = null;
  const { bot, calls } = createHarness({
    lookupTelegramLink: async () => ({ state: "linked", link: ACTIVE_LINK }),
    walletBalance: async (address) => {
      receivedAddress = address;
      return { ok: true, data: snapshot() };
    },
  });

  await deliver(bot, textUpdate("/balance"));

  assert.equal(receivedAddress, MERCHANT_WALLET);
  const messages = callsOf(calls, "sendMessage");
  assert.equal(messages.length, 1);

  const text = messageText(messages[0]);
  assert.match(text, /PayProof Wallet Balance/);
  assert.match(text, /Balance: 12\.458 SOL/);
  assert.match(text, /Not available on Devnet/);
  assert.match(text, /Network: Solana Devnet/);
});

test("/balance never uses an address supplied in the command arguments", async () => {
  let receivedAddress: string | null = null;
  const { bot } = createHarness({
    lookupTelegramLink: async () => ({ state: "linked", link: ACTIVE_LINK }),
    walletBalance: async (address) => {
      receivedAddress = address;
      return { ok: true, data: snapshot() };
    },
  });

  await deliver(bot, textUpdate(`/balance ${OTHER_MERCHANT_WALLET}`));

  assert.equal(receivedAddress, MERCHANT_WALLET);
});

test("/balance explains linking when no merchant account is linked", async () => {
  let readerCalls = 0;
  const { bot, calls } = createHarness({
    lookupTelegramLink: async () => ({ state: "not_linked" }),
    walletBalance: async () => {
      readerCalls += 1;
      return { ok: true, data: snapshot() };
    },
  });

  await deliver(bot, textUpdate("/balance"));

  assert.equal(readerCalls, 0);
  const messages = callsOf(calls, "sendMessage");
  assert.equal(messages.length, 1);
  assert.equal(messageText(messages[0]), accountLinkingRequiredText("balance"));
});

test("/balance reports a lookup failure separately from an unlinked account", async () => {
  let readerCalls = 0;
  const { bot, calls } = createHarness({
    lookupTelegramLink: async () => ({ state: "unavailable" }),
    walletBalance: async () => {
      readerCalls += 1;
      return { ok: true, data: snapshot() };
    },
  });

  await deliver(bot, textUpdate("/balance"));

  assert.equal(readerCalls, 0);
  assert.equal(
    messageText(callsOf(calls, "sendMessage")[0]),
    MERCHANT_LOOKUP_FAILED_TEXT,
  );
});

test("/balance reports a read failure without inventing a balance", async () => {
  const { bot, calls } = createHarness({
    lookupTelegramLink: async () => ({ state: "linked", link: ACTIVE_LINK }),
    walletBalance: async () => ({ ok: false }),
  });

  await deliver(bot, textUpdate("/balance"));

  const messages = callsOf(calls, "sendMessage");
  assert.equal(messages.length, 1);
  assert.equal(messageText(messages[0]), BALANCE_UNAVAILABLE_TEXT);
});

test("/balance enforces a five-second per-user cooldown", async () => {
  let clock = 10_000;
  let readerCalls = 0;
  const { bot, calls } = createHarness({
    lookupTelegramLink: async () => ({ state: "linked", link: ACTIVE_LINK }),
    walletBalance: async () => {
      readerCalls += 1;
      return { ok: true, data: snapshot() };
    },
    now: () => clock,
  });

  await deliver(bot, textUpdate("/balance"));
  assert.equal(readerCalls, 1);

  clock += 4_000;
  await deliver(bot, textUpdate("/balance"));
  assert.equal(readerCalls, 1, "second check inside the window must be skipped");
  assert.equal(
    messageText(callsOf(calls, "sendMessage").at(-1)!),
    BALANCE_COOLDOWN_TEXT,
  );

  clock += 2_000;
  await deliver(bot, textUpdate("/balance"));
  assert.equal(readerCalls, 2, "a check after the window must run again");
});

test("a stale Balance button after unlinking is rejected without reading a wallet", async () => {
  let linked = true;
  let readerCalls = 0;
  const { bot, calls } = createHarness({
    lookupTelegramLink: async () =>
      linked ? { state: "linked", link: ACTIVE_LINK } : { state: "not_linked" },
    walletBalance: async () => {
      readerCalls += 1;
      return { ok: true, data: snapshot() };
    },
  });

  await deliver(bot, textUpdate("/balance"));
  assert.equal(readerCalls, 1);

  // The chat was unlinked while the menu was still on screen.
  linked = false;
  await deliver(bot, callbackUpdate("balance"));

  assert.equal(readerCalls, 1, "no wallet read may happen after unlinking");
  const messages = callsOf(calls, "sendMessage");
  assert.equal(
    messageText(messages.at(-1)!),
    accountLinkingRequiredText("balance"),
  );
});

test("the balance cooldown does not interfere with other commands", async () => {
  let clock = 10_000;
  const { bot, calls } = createHarness({
    lookupTelegramLink: async () => ({ state: "linked", link: ACTIVE_LINK }),
    walletBalance: async () => ({ ok: true, data: snapshot() }),
    now: () => clock,
  });

  await deliver(bot, textUpdate("/balance"));
  clock += 1_000;
  await deliver(bot, textUpdate("/summary"));

  const messages = callsOf(calls, "sendMessage");
  const last = messageText(messages.at(-1)!);
  assert.match(last, /Payment summary/);
  assert.ok(!last.includes(BALANCE_COOLDOWN_TEXT));
});
