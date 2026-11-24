import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import test from "node:test";
import { Bot, type Transformer } from "grammy";
import type { Update } from "grammy/types";

import {
  CONNECT_TEXT,
  DATA_UNAVAILABLE_TEXT,
  FALLBACK_TEXT,
  HELP_TEXT,
  MAIN_MENU_TEXT,
  MENU_ACTIONS,
  MERCHANT_LOOKUP_FAILED_TEXT,
  NON_TEXT_MESSAGE_TEXT,
  NOTIFICATIONS_TEXT,
  RECEIPT_INVALID_TEXT,
  RECEIPT_NOT_FOUND_TEXT,
  RECEIPT_PICKER_EMPTY_TEXT,
  RECEIPT_PICKER_TEXT,
  SETTINGS_TEXT,
  STALE_CALLBACK_TEXT,
  STATUS_TEXT,
  STATUS_UNAVAILABLE_TEXT,
  UNKNOWN_CALLBACK_TEXT,
  UNKNOWN_COMMAND_TEXT,
  UNLINK_CANCELLED_TEXT,
  UNLINK_CONFIRM_TEXT,
  UNLINK_FAILED_TEXT,
  UNLINK_NONE_TEXT,
  UNLINK_SUCCESS_TEXT,
  parseLinkToken,
  registerHandlers,
  toActiveTelegramLink,
  type HandlerDependencies,
  type MenuAction,
}  from "../src/handlers.js";
import {
  NOTIF_TEST_ACTION,
  NOTIFICATION_EVENT_TYPES,
  type NotificationEventType,
  type NotificationPreferenceStore,
} from "../src/lib/notification-preferences.js";
import {
  isVerifiedPayment,
  normalizeStoredPaymentStatus,
  summarizePayments,
  type PayProofData,
  type StoredPayment,
} from "../src/lib/payproof.js";
import { sendTestNotificationToMerchant } from "../src/lib/telegram-notify.js";

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
const CALLBACK_ID = "cb-1";
const FROM = { id: 42, is_bot: false, first_name: "Merchant" };

function fakeData(overrides: Partial<PayProofData> = {}): PayProofData {
  const base: PayProofData = {
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

  return { ...base, ...overrides };
}

function createHarness(
  deps: HandlerDependencies = {},
): { bot: Bot; calls: ApiCall[] } {
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
      result = { message_id: calls.length, date: 0, chat: { id: CHAT_ID, type: "private" } };
    }
    return { ok: true, result };
  }) as unknown as Transformer;

  bot.api.config.use(transformer);

  // Tests never reach the network: default to "no active link", empty data and
  // a no-op unlink.
  const resolved: HandlerDependencies = {
    lookupTelegramLink: async () => ({ state: "not_linked" }),
    data: fakeData(),
    unlinkTelegramAccount: async () => ({ ok: false }),
    notificationPreferences: memoryPreferenceStore(),
    sendTestNotification: async () => ({ ok: true }),
    ...deps,
  };

  registerHandlers(bot, resolved);

  return { bot, calls };
}

async function deliver(bot: Bot, update: Update): Promise<void> {
  await bot.init();
  await bot.handleUpdate(update);
}

/**
 * In-memory preference store: tests never touch Supabase, and it records every
 * write so merchant isolation and no-op paths can be asserted.
 */
function memoryPreferenceStore(
  initial: Partial<Record<NotificationEventType, boolean | null>> = {},
): NotificationPreferenceStore & {
  writes: Array<{ merchantAddress: string; eventType: NotificationEventType; enabled: boolean }>;
  state: Map<string, Record<NotificationEventType, boolean | null>>;
} {
  const empty = (): Record<NotificationEventType, boolean | null> => ({
    payment_request_created: null,
    payment_received: null,
    payment_failed: null,
    payment_request_expired: null,
    payment_request_cancelled: null,
  });

  const state = new Map<string, Record<NotificationEventType, boolean | null>>();
  const writes: Array<{
    merchantAddress: string;
    eventType: NotificationEventType;
    enabled: boolean;
  }> = [];

  return {
    state,
    writes,
    async getAll(merchantAddress) {
      const existing = state.get(merchantAddress);
      if (existing) return { ...existing };
      return { ...empty(), ...initial };
    },
    async set(merchantAddress, eventType, enabled) {
      const current = state.get(merchantAddress) ?? { ...empty(), ...initial };
      state.set(merchantAddress, { ...current, [eventType]: enabled });
      writes.push({ merchantAddress, eventType, enabled });
      return true;
    },
  };
}

function callbackUpdate(data?: string): Update {
  return {
    update_id: 1,
    callback_query: {
      id: CALLBACK_ID,
      from: FROM,
      chat_instance: "chat-instance",
      message: {
        message_id: 10,
        date: 0,
        chat: { id: CHAT_ID, type: "private" },
        text: "menu",
      },
      ...(data === undefined ? {} : { data }),
    },
  } as unknown as Update;
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

function photoUpdate(): Update {
  return {
    update_id: 3,
    message: {
      message_id: 30,
      date: 0,
      chat: { id: CHAT_ID, type: "private" },
      from: FROM,
      photo: [{ file_id: "file-1", file_unique_id: "unique-1", width: 10, height: 10 }],
    },
  } as unknown as Update;
}

function callsOf(calls: ApiCall[], method: string): ApiCall[] {
  return calls.filter((call) => call.method === method);
}

function messageText(call: ApiCall): string {
  return typeof call.payload.text === "string" ? call.payload.text : "";
}

function replyMarkup(call: ApiCall): string {
  return JSON.stringify(call.payload.reply_markup ?? {});
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const LINKED_AT = "2026-11-18T09:30:00.000Z";
const MERCHANT_WALLET = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const OTHER_MERCHANT_WALLET = "8h7YwLrTQAg8PtEPibhRZfKgWgXKjYFtiys5yqNg8fXW";
const VERIFIED_REFERENCE = "7h7YwLrTQAg8PtEPibhRZfKgWgXKjYFtiys5yqNg8fXW";
const PENDING_REFERENCE = "3xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFi";

const ACTIVE_LINK = {
  merchantAddress: MERCHANT_WALLET,
  telegramUserId: FROM.id,
  telegramChatId: CHAT_ID,
  linkedAt: LINKED_AT,
};

const ACTIVE_ROW = {
  merchant_wallet_address: MERCHANT_WALLET,
  telegram_user_id: FROM.id,
  telegram_chat_id: CHAT_ID,
  linked_at: LINKED_AT,
  unlinked_at: null,
};

const VERIFIED_PAYMENT: StoredPayment = {
  id: "PR-11111111",
  reference: VERIFIED_REFERENCE,
  amountLamports: "1500000000",
  description: "Invoice 1042",
  customerName: null,
  status: "paid",
  transactionSignature: "5VerifiedSignature111",
  payerAddress: "Cust1111111111111111111111111111111111111111",
  verifiedAt: "2026-11-18T09:30:00.000Z",
  createdAt: "2026-11-17T09:00:00.000Z",
};

const PENDING_PAYMENT: StoredPayment = {
  id: "PR-22222222",
  reference: PENDING_REFERENCE,
  amountLamports: "500000000",
  description: "Invoice 1043",
  customerName: null,
  status: "pending",
  transactionSignature: null,
  payerAddress: null,
  verifiedAt: null,
  createdAt: "2026-11-18T10:00:00.000Z",
};

// `paid` without verifier evidence must never count as revenue or a receipt.
const UNVERIFIED_PAYMENT: StoredPayment = {
  ...VERIFIED_PAYMENT,
  id: "PR-33333333",
  amountLamports: "9900000000",
  status: "paid",
  transactionSignature: null,
  payerAddress: null,
  verifiedAt: null,
};

function linkedHarness(data: PayProofData, link = ACTIVE_LINK) {
  return createHarness({
    lookupTelegramLink: async () => ({ state: "linked", link }),
    data,
  });
}

function firstReply(calls: ApiCall[]): ApiCall {
  return callsOf(calls, "sendMessage")[0];
}

// ---------------------------------------------------------------------------
// Dashboard buttons and handlers
// ---------------------------------------------------------------------------

const BUTTONS: Array<[MenuAction, string]> = [
  ["payment_summary", "📊 Payment summary"],
  ["transactions", "🧾 Recent transactions"],
  ["pending", "⏳ Pending payments"],
  ["receipts", "🧾 Receipts"],
  ["notifications", "🔔 Notifications"],
  ["settings", "⚙️ Settings"],
  ["account_status", "PayProof Notify — Status"],
  ["unlink", "🔓 Unlink account"],
  ["connect", "⌁ Connect PayProof"],
  ["main_menu", "Welcome to PayProof Notify"],
];

for (const [action, expected] of BUTTONS) {
  test(`dashboard button "${action}" is answered and sends its own screen`, async () => {
    const { bot, calls } = createHarness();
    await deliver(bot, callbackUpdate(action));

    const answers = callsOf(calls, "answerCallbackQuery");
    assert.equal(answers.length, 1, "callback query must be answered exactly once");
    assert.equal(answers[0].payload.callback_query_id, CALLBACK_ID);

    const messages = callsOf(calls, "sendMessage");
    assert.equal(messages.length, 1, "exactly one reply per button press");
    assert.equal(messages[0].payload.chat_id, CHAT_ID);
    assert.ok(
      messageText(messages[0]).includes(expected),
      `${action} reply is missing "${expected}"`,
    );

    for (const [other, otherText] of BUTTONS) {
      if (other === action) continue;
      if (otherText.startsWith(expected) && otherText !== expected) {
        assert.ok(!messageText(messages[0]).includes(otherText));
      }
    }
  });
}

test("dashboard exposes every advertised action and a connect button", async () => {
  const { bot, calls } = createHarness();
  await deliver(bot, textUpdate("/start"));

  const messages = callsOf(calls, "sendMessage");
  assert.equal(messages.length, 1);
  assert.equal(messageText(messages[0]), MAIN_MENU_TEXT);

  const markup = replyMarkup(messages[0]);
  for (const action of MENU_ACTIONS) {
    if (action === "main_menu") continue;
    assert.ok(markup.includes(`"${action}"`), `dashboard is missing ${action}`);
  }
  assert.ok(markup.includes('"connect"'), "dashboard must offer connecting PayProof");
});

test("every menu action has a dedicated registered handler", async () => {
  for (const action of MENU_ACTIONS) {
    const { bot, calls } = createHarness();
    await deliver(bot, callbackUpdate(action));
    const [answer] = callsOf(calls, "answerCallbackQuery");
    assert.notEqual(
      answer.payload.text,
      UNKNOWN_CALLBACK_TEXT,
      `${action} fell through to the fallback`,
    );
    assert.equal(callsOf(calls, "sendMessage").length, 1, `${action} sent no screen`);
  }
});

test("every implemented command replies instead of being unknown", async () => {
  const commands = [
    "/start",
    "/menu",
    "/help",
    "/status",
    "/summary",
    "/transactions",
    "/pending",
    "/receipt",
    "/unlink",
    "/settings",
    "/notifications",
  ];

  for (const command of commands) {
    const { bot, calls } = createHarness();
    await deliver(bot, textUpdate(command));

    const messages = callsOf(calls, "sendMessage");
    assert.equal(messages.length, 1, `${command} sent ${messages.length} messages`);
    assert.notEqual(messageText(messages[0]), UNKNOWN_COMMAND_TEXT, `${command} is not handled`);
  }
});

test("help lists every implemented command", async () => {
  const { bot, calls } = createHarness();
  await deliver(bot, textUpdate("/help"));

  const text = messageText(firstReply(calls));
  assert.equal(text, HELP_TEXT);

  for (const command of [
    "/start",
    "/menu",
    "/help",
    "/status",
    "/summary",
    "/transactions",
    "/pending",
    "/receipt",
    "/unlink",
    "/settings",
    "/notifications",
  ]) {
    assert.ok(text.includes(command), `help is missing ${command}`);
  }
});

// ---------------------------------------------------------------------------
// Unlinked accounts: actionable guidance and no fabricated data
// ---------------------------------------------------------------------------

for (const action of [
  "payment_summary",
  "transactions",
  "pending",
  "receipts",
] as const) {
  test(`"${action}" asks an unlinked account to connect`, async () => {
    const { bot, calls } = createHarness();
    await deliver(bot, callbackUpdate(action));

    const reply = firstReply(calls);
    const text = messageText(reply);
    assert.match(text, /No PayProof merchant account is linked/i);
    assert.match(text, /link your payproof account/i);
    assert.doesNotMatch(text, /future update/i);
    assert.ok(replyMarkup(reply).includes('"connect"'), "must offer Connect PayProof");

    // Never invent records, amounts or signatures for an unlinked chat.
    assert.doesNotMatch(text, /\d[\d,.]*\s*SOL/i);
    assert.doesNotMatch(text, /payment received/i);
    assert.doesNotMatch(text, /\b(signature|transaction id|request id)\b/i);
  });
}

test("settings shows the unlinked state without secrets", async () => {
  const { bot, calls } = createHarness();
  await deliver(bot, callbackUpdate("settings"));

  const text = messageText(firstReply(calls));
  assert.equal(text, SETTINGS_TEXT);
  assert.match(text, /Merchant account: Not linked/);
  assert.match(text, /Payment notifications: Not configured/);
  assert.doesNotMatch(text, /SUPABASE_SERVICE_ROLE_KEY|service[_ -]role[_ -]key/i);
  assert.doesNotMatch(text, /\b[A-Za-z0-9_-]{32,}\b/);
});

test("connect screen explains the real linking flow", async () => {
  const { bot, calls } = createHarness();
  await deliver(bot, callbackUpdate("connect"));

  assert.equal(messageText(firstReply(calls)), CONNECT_TEXT);
  assert.match(CONNECT_TEXT, /Settings → Telegram/);
  // No invented credentials or wallet addresses.
  assert.doesNotMatch(CONNECT_TEXT, /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/);
});

test("help works without a linked account", async () => {
  const { bot, calls } = createHarness();
  await deliver(bot, callbackUpdate("help"));

  assert.equal(messageText(firstReply(calls)), HELP_TEXT);
});

// ---------------------------------------------------------------------------
// Account status
// ---------------------------------------------------------------------------

test("/status reports the unlinked state with a connect button", async () => {
  const { bot, calls } = createHarness();
  await deliver(bot, textUpdate("/status"));

  const reply = firstReply(calls);
  assert.equal(messageText(reply), STATUS_TEXT);
  assert.match(messageText(reply), /Merchant account: Not linked/);
  assert.ok(replyMarkup(reply).includes('"connect"'));
});

test("linked account: /status shows the wallet and honest notification state", async () => {
  let queriedId: number | null = null;
  const { bot, calls } = createHarness({
    lookupTelegramLink: async (telegramUserId) => {
      queriedId = telegramUserId;
      return { state: "linked", link: ACTIVE_LINK };
    },
    data: fakeData(),
  });

  await deliver(bot, textUpdate("/status"));

  const text = messageText(firstReply(calls));
  assert.match(text, /^PayProof Notify — Status/);
  assert.match(text, /Bot: Online/);
  assert.match(text, /Merchant account: Linked/);
  assert.ok(text.includes(`Merchant wallet: ${MERCHANT_WALLET}`));
  assert.doesNotMatch(text, /Merchant wallet: None/);
  assert.match(text, /Payment notifications: Ready/);
  assert.match(text, /only when enabled/i);
  assert.equal(queriedId, FROM.id, "lookup must use the Telegram user id");
});

test("unknown Telegram account: /status is not linked and queries the user id", async () => {
  const queried: number[] = [];
  const { bot, calls } = createHarness({
    lookupTelegramLink: async (telegramUserId) => {
      queried.push(telegramUserId);
      return { state: "not_linked" };
    },
  });

  await deliver(bot, textUpdate("/status"));

  assert.deepEqual(queried, [FROM.id]);
  assert.match(messageText(firstReply(calls)), /Merchant account: Not linked/);
});

test("missing record and soft-deleted rows are never reported as linked", () => {
  assert.equal(toActiveTelegramLink(null), null);
  assert.equal(toActiveTelegramLink(undefined), null);
  assert.deepEqual(toActiveTelegramLink(ACTIVE_ROW), ACTIVE_LINK);
  assert.equal(
    toActiveTelegramLink({ ...ACTIVE_ROW, unlinked_at: "2026-11-18T10:00:00.000Z" }),
    null,
  );
  assert.equal(
    toActiveTelegramLink({ ...ACTIVE_ROW, merchant_wallet_address: "   " }),
    null,
  );
});

test("database lookup failure: status reports unavailable, not unlinked", async () => {
  const { bot, calls } = createHarness({
    lookupTelegramLink: async () => ({ state: "unavailable" }),
  });

  await deliver(bot, textUpdate("/status"));

  const text = messageText(firstReply(calls));
  assert.equal(text, STATUS_UNAVAILABLE_TEXT);
  assert.doesNotMatch(text, /Merchant account: Not linked/);
});

// ---------------------------------------------------------------------------
// Linked merchant: real PayProof data, scoped to the linked wallet
// ---------------------------------------------------------------------------

test("linked merchant: /summary shows verified totals for the linked wallet", async () => {
  let asked: string | null = null;
  const data = fakeData({
    getSummary: async (merchantAddress) => {
      asked = merchantAddress;
      return {
        ok: true,
        data: {
          verifiedCount: 2,
          verifiedLamports: 1_500_000_000n,
          pendingCount: 1,
          failedCount: 0,
        },
      };
    },
  });

  const { bot, calls } = linkedHarness(data);
  await deliver(bot, textUpdate("/summary"));

  const text = messageText(firstReply(calls));
  assert.equal(asked, MERCHANT_WALLET, "data must be scoped to the linked wallet");
  assert.match(text, /Merchant wallet: 9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin/);
  assert.match(text, /Verified payments: 2/);
  assert.match(text, /Verified revenue: 1\.5 SOL/);
  assert.match(text, /Pending requests: 1/);
  assert.match(text, /Failed \/ Cancelled \/ Expired: 0/);
  assert.doesNotMatch(text, /future update/i);
});

test("linked merchant: summary button refreshes with real data", async () => {
  const data = fakeData({
    getSummary: async () => ({
      ok: true,
      data: {
        verifiedCount: 1,
        verifiedLamports: 2_000_000_000n,
        pendingCount: 0,
        failedCount: 0,
      },
    }),
  });

  const { bot, calls } = linkedHarness(data);
  await deliver(bot, callbackUpdate("payment_summary"));

  const reply = firstReply(calls);
  assert.match(messageText(reply), /Verified revenue: 2 SOL/);
  const markup = replyMarkup(reply);
  assert.ok(markup.includes('"payment_summary"'), "refresh button must repeat the view");
  assert.ok(markup.includes('"main_menu"'), "back to menu must exist");
});

test("linked merchant: recent transactions show every status newest-first", async () => {
  let asked: string | null = null;
  let askedLimit: number | undefined;
  const newestPending: StoredPayment = {
    ...PENDING_PAYMENT,
    id: "PR-66666666",
    reference: "NewestPending111111111111111111111111111111",
    description: "New order",
    amountLamports: "500000000",
    createdAt: "2026-11-21T12:00:00.000Z",
  };
  const failed: StoredPayment = {
    ...PENDING_PAYMENT,
    id: "PR-77777777",
    reference: "FailedPayment111111111111111111111111111111",
    description: "Test payment",
    amountLamports: "1000000000",
    status: "failed",
    createdAt: "2026-11-21T11:00:00.000Z",
  };
  const cancelled: StoredPayment = {
    ...PENDING_PAYMENT,
    id: "PR-88888888",
    reference: "CancelledPayment111111111111111111111111111",
    description: "Cancelled order",
    amountLamports: "2000000000",
    status: "cancelled",
    createdAt: "2026-11-21T10:00:00.000Z",
  };
  const expired: StoredPayment = {
    ...PENDING_PAYMENT,
    id: "PR-99999999",
    reference: "ExpiredPayment11111111111111111111111111111",
    description: "Old request",
    amountLamports: "3000000000",
    status: "expired",
    createdAt: "2026-11-21T09:00:00.000Z",
  };

  const data = fakeData({
    getRecentTransactions: async (merchantAddress, limit) => {
      asked = merchantAddress;
      askedLimit = limit;
      return {
        ok: true,
        data: [newestPending, failed, cancelled, expired, VERIFIED_PAYMENT],
      };
    },
  });

  const { bot, calls } = linkedHarness(data);
  await deliver(bot, textUpdate("/transactions"));

  const text = messageText(firstReply(calls));
  assert.equal(asked, MERCHANT_WALLET);
  assert.equal(askedLimit, 5);
  assert.match(text, /Recent transactions/);
  assert.match(text, /Status: Pending/);
  assert.match(text, /Status: Failed/);
  assert.match(text, /Status: Cancelled/);
  assert.match(text, /Status: Expired/);
  assert.match(text, /Status: Paid/);
  assert.match(text, /🟡 0\.5 SOL — New order/);
  assert.match(text, /🔴 1 SOL — Test payment/);
  assert.match(text, /⚪ 2 SOL — Cancelled order/);
  assert.match(text, /⚪ 3 SOL — Old request/);
  assert.match(text, /🟢 1\.5 SOL — Invoice 1042/);
  assert.match(text, /Verified: 2026-11-18/);
  assert.match(text, /Created: 2026-11-21/);

  // Query order is preserved: newest request first, verified payment last.
  assert.ok(text.indexOf("New order") < text.indexOf("Test payment"));
  assert.ok(text.indexOf("Test payment") < text.indexOf("Cancelled order"));
  assert.ok(text.indexOf("Cancelled order") < text.indexOf("Old request"));
  assert.ok(text.indexOf("Old request") < text.indexOf("Invoice 1042"));

  // Every request appears once; payment attempts are never separate rows.
  for (const reference of [
    newestPending.reference,
    failed.reference,
    cancelled.reference,
    expired.reference,
    VERIFIED_REFERENCE,
  ]) {
    assert.equal(text.split(reference).length - 1, 1, `${reference} must appear once`);
  }
});

test("linked merchant: pending payments list real pending requests", async () => {
  const data = fakeData({
    getPending: async () => ({ ok: true, data: [PENDING_PAYMENT] }),
  });

  const { bot, calls } = linkedHarness(data);
  await deliver(bot, textUpdate("/pending"));

  const text = messageText(firstReply(calls));
  assert.match(text, /Pending payments/);
  assert.match(text, /0\.5 SOL/);
  assert.ok(text.includes(PENDING_REFERENCE));
});

test("empty payment history is handled gracefully", async () => {
  const { bot, calls } = linkedHarness(fakeData());

  await deliver(bot, textUpdate("/transactions"));
  const transactions = messageText(firstReply(calls));
  assert.match(transactions, /No payment requests yet/i);
  assert.doesNotMatch(transactions, /\d+(\.\d+)? SOL/);

  const second = linkedHarness(fakeData());
  await deliver(second.bot, textUpdate("/pending"));
  assert.match(messageText(firstReply(second.calls)), /No pending payment requests/i);
});

test("verified and unverified payments are distinguished", () => {
  assert.equal(isVerifiedPayment(VERIFIED_PAYMENT), true);
  assert.equal(isVerifiedPayment(PENDING_PAYMENT), false);
  assert.equal(isVerifiedPayment(UNVERIFIED_PAYMENT), false);
  assert.equal(isVerifiedPayment({ ...VERIFIED_PAYMENT, verifiedAt: null }), false);

  const summary = summarizePayments([
    VERIFIED_PAYMENT,
    UNVERIFIED_PAYMENT,
    PENDING_PAYMENT,
    { ...PENDING_PAYMENT, id: "PR-44444444", status: "expired" },
    { ...PENDING_PAYMENT, id: "PR-55555555", status: "failed" },
  ]);

  assert.equal(summary.verifiedCount, 1);
  assert.equal(summary.verifiedLamports, 1_500_000_000n);
  // A failed request is closed work, never pending.
  assert.equal(summary.pendingCount, 1);
  assert.equal(summary.failedCount, 2);
});

test("stored failed status is preserved instead of becoming pending", () => {
  assert.equal(normalizeStoredPaymentStatus("failed"), "failed");
  assert.equal(normalizeStoredPaymentStatus("pending"), "pending");
  assert.equal(normalizeStoredPaymentStatus("paid"), "paid");
  assert.equal(normalizeStoredPaymentStatus("expired"), "expired");
  assert.equal(normalizeStoredPaymentStatus("cancelled"), "cancelled");
});

test("merchant data isolation: only the linked wallet is queried", async () => {
  const asked: string[] = [];
  const data = fakeData({
    getSummary: async (merchantAddress) => {
      asked.push(merchantAddress);
      return {
        ok: true,
        data: {
          verifiedCount: 1,
          verifiedLamports: 1_000_000_000n,
          pendingCount: 0,
          failedCount: 0,
        },
      };
    },
  });

  const { bot, calls } = linkedHarness(data, {
    ...ACTIVE_LINK,
    merchantAddress: OTHER_MERCHANT_WALLET,
  });

  await deliver(bot, textUpdate("/summary"));

  const text = messageText(firstReply(calls));
  assert.deepEqual(asked, [OTHER_MERCHANT_WALLET]);
  assert.ok(text.includes(OTHER_MERCHANT_WALLET));
  assert.ok(!text.includes(MERCHANT_WALLET), "must not leak another merchant's wallet");
});

test("merchant lookup failure: screens never claim the account is unlinked", async () => {
  let dataCalled = false;
  const { bot, calls } = createHarness({
    lookupTelegramLink: async () => ({ state: "unavailable" }),
    data: fakeData({
      getSummary: async () => {
        dataCalled = true;
        return {
          ok: true,
          data: {
            verifiedCount: 0,
            verifiedLamports: 0n,
            pendingCount: 0,
            failedCount: 0,
          },
        };
      },
    }),
  });

  await deliver(bot, callbackUpdate("payment_summary"));

  const text = messageText(firstReply(calls));
  assert.equal(text, MERCHANT_LOOKUP_FAILED_TEXT);
  assert.equal(dataCalled, false);
  assert.doesNotMatch(text, /Not linked/i);
});

test("data failure: linked merchant sees a retry message, not fake data", async () => {
  const { bot, calls } = linkedHarness(
    fakeData({ getSummary: async () => ({ ok: false }) }),
  );

  await deliver(bot, callbackUpdate("payment_summary"));

  const text = messageText(firstReply(calls));
  assert.equal(text, DATA_UNAVAILABLE_TEXT);
  assert.doesNotMatch(text, /Verified payments:/);
});

// ---------------------------------------------------------------------------
// Receipts
// ---------------------------------------------------------------------------

test("receipts: picker lists verified payments and selection returns the receipt", async () => {
  const data = fakeData({
    getRecentVerified: async () => ({ ok: true, data: [VERIFIED_PAYMENT] }),
    getVerifiedReceipt: async () => ({ ok: true, data: VERIFIED_PAYMENT }),
  });

  const { bot, calls } = linkedHarness(data);
  await deliver(bot, textUpdate("/receipt"));

  const picker = firstReply(calls);
  assert.equal(messageText(picker), RECEIPT_PICKER_TEXT);
  assert.ok(replyMarkup(picker).includes(`receipt:${VERIFIED_REFERENCE}`));

  await deliver(bot, callbackUpdate(`receipt:${VERIFIED_REFERENCE}`));

  const receipt = messageText(callsOf(calls, "sendMessage").at(-1)!);
  assert.match(receipt, /Payment receipt/);
  assert.ok(receipt.includes(VERIFIED_REFERENCE));
  assert.ok(receipt.includes(VERIFIED_PAYMENT.transactionSignature!));
  assert.ok(receipt.includes(VERIFIED_PAYMENT.payerAddress!));
  assert.match(receipt, /Verified on Solana/);
});

test("receipts: empty picker is handled gracefully", async () => {
  const { bot, calls } = linkedHarness(fakeData());
  await deliver(bot, textUpdate("/receipt"));

  assert.equal(messageText(firstReply(calls)), RECEIPT_PICKER_EMPTY_TEXT);
});

test("receipts: verified reference returns actual on-chain evidence", async () => {
  const data = fakeData({
    getVerifiedReceipt: async () => ({ ok: true, data: VERIFIED_PAYMENT }),
  });

  const { bot, calls } = linkedHarness(data);
  await deliver(bot, textUpdate(`/receipt ${VERIFIED_REFERENCE}`));

  const text = messageText(firstReply(calls));
  assert.match(text, /Payment receipt/);
  assert.ok(text.includes(VERIFIED_PAYMENT.transactionSignature!));
});

test("receipts: unverified payment is not issued as a receipt", async () => {
  const data = fakeData({
    getVerifiedReceipt: async () => ({ ok: true, data: null }),
  });

  const { bot, calls } = linkedHarness(data);
  await deliver(bot, textUpdate(`/receipt ${VERIFIED_REFERENCE}`));

  assert.equal(messageText(firstReply(calls)), RECEIPT_NOT_FOUND_TEXT);
});

test("receipts: malformed references are rejected without a query", async () => {
  let queried = false;
  const data = fakeData({
    getVerifiedReceipt: async () => {
      queried = true;
      return { ok: true, data: null };
    },
  });

  const { bot, calls } = linkedHarness(data);
  await deliver(bot, textUpdate("/receipt not-a-reference"));

  assert.equal(messageText(firstReply(calls)), RECEIPT_INVALID_TEXT);
  assert.equal(queried, false);
});

test("receipts: unlinked account is told to link instead of querying", async () => {
  const { bot, calls } = createHarness();
  await deliver(bot, textUpdate(`/receipt ${VERIFIED_REFERENCE}`));

  const text = messageText(firstReply(calls));
  assert.match(text, /No PayProof merchant account is linked/i);
  assert.ok(replyMarkup(firstReply(calls)).includes('"connect"'));
});

// ---------------------------------------------------------------------------
// Settings and notifications
// ---------------------------------------------------------------------------

test("linked settings shows the wallet and the saved per-event state", async () => {
  const store = memoryPreferenceStore({ payment_received: true });
  const { bot, calls } = createHarness({
    lookupTelegramLink: async () => ({ state: "linked", link: ACTIVE_LINK }),
    data: fakeData(),
    notificationPreferences: store,
  });

  await deliver(bot, callbackUpdate("settings"));

  const reply = firstReply(calls);
  const text = messageText(reply);
  assert.match(text, /Merchant account: Linked/);
  assert.ok(text.includes(MERCHANT_WALLET));
  assert.match(text, /Payment received: Enabled/);
  assert.match(text, /Request created: Not set/);
  assert.doesNotMatch(text, /Merchant wallet: None/);
  assert.ok(replyMarkup(reply).includes('"notifications"'));
});

test("unlinked notifications screen offers linking and no toggles", async () => {
  const { bot, calls } = createHarness();
  await deliver(bot, callbackUpdate("notifications"));

  const reply = firstReply(calls);
  const text = messageText(reply);
  assert.equal(text, NOTIFICATIONS_TEXT);
  assert.match(text, /never triggered by a browser request/i);

  // Nothing to toggle without a linked merchant, so no toggle button exists.
  const markup = replyMarkup(reply);
  assert.doesNotMatch(markup, /notif_toggle:/);
  assert.ok(markup.includes('"connect"'));
  assert.ok(markup.includes('"main_menu"'));
});

test("the notifications screen states the trusted trigger and makes no delivery claim", async () => {
  // The bot must not push messages on its own; a single interaction yields a
  // single reply, and the text must not promise delivery guarantees the
  // pipeline does not make.
  const { bot, calls } = createHarness();
  await deliver(bot, callbackUpdate("notifications"));

  assert.equal(callsOf(calls, "sendMessage").length, 1);
  assert.equal(callsOf(calls, "answerCallbackQuery").length, 1);
  assert.match(NOTIFICATIONS_TEXT, /verified on Solana/);
  assert.doesNotMatch(NOTIFICATIONS_TEXT, /exactly once|guaranteed/i);
});

// ---------------------------------------------------------------------------
// Unlink
// ---------------------------------------------------------------------------

test("/unlink asks for confirmation and does not write yet", async () => {
  let unlinkCalls = 0;
  const { bot, calls } = createHarness({
    lookupTelegramLink: async () => ({ state: "linked", link: ACTIVE_LINK }),
    data: fakeData(),
    unlinkTelegramAccount: async () => {
      unlinkCalls += 1;
      return { ok: true, data: true };
    },
  });

  await deliver(bot, textUpdate("/unlink"));

  const reply = firstReply(calls);
  assert.equal(messageText(reply), UNLINK_CONFIRM_TEXT);
  assert.ok(replyMarkup(reply).includes('"unlink_confirm"'));
  assert.ok(replyMarkup(reply).includes('"unlink_cancel"'));
  assert.equal(unlinkCalls, 0);
});

test("unlink confirmation disconnects the linked Telegram identity", async () => {
  let unlinkedUser: number | null = null;
  const { bot, calls } = createHarness({
    lookupTelegramLink: async () => ({ state: "linked", link: ACTIVE_LINK }),
    data: fakeData(),
    unlinkTelegramAccount: async (telegramUserId) => {
      unlinkedUser = telegramUserId;
      return { ok: true, data: true };
    },
  });

  await deliver(bot, callbackUpdate("unlink_confirm"));

  const reply = firstReply(calls);
  assert.equal(unlinkedUser, FROM.id, "unlink must target the resolved Telegram user");
  assert.equal(messageText(reply), UNLINK_SUCCESS_TEXT);
  assert.match(messageText(reply), /Payment history and merchant records were not changed/);
  assert.ok(replyMarkup(reply).includes('"connect"'), "must offer re-linking");
});

test("unlink cancellation keeps the account linked", async () => {
  let unlinkCalls = 0;
  const { bot, calls } = createHarness({
    lookupTelegramLink: async () => ({ state: "linked", link: ACTIVE_LINK }),
    data: fakeData(),
    unlinkTelegramAccount: async () => {
      unlinkCalls += 1;
      return { ok: true, data: true };
    },
  });

  await deliver(bot, callbackUpdate("unlink_cancel"));

  assert.equal(unlinkCalls, 0);
  assert.equal(messageText(firstReply(calls)), UNLINK_CANCELLED_TEXT);
});

test("unlink on an unlinked account writes nothing", async () => {
  let unlinkCalls = 0;
  const { bot, calls } = createHarness({
    unlinkTelegramAccount: async () => {
      unlinkCalls += 1;
      return { ok: true, data: true };
    },
  });

  await deliver(bot, callbackUpdate("unlink_confirm"));

  assert.equal(unlinkCalls, 0);
  assert.equal(messageText(firstReply(calls)), UNLINK_NONE_TEXT);
});

test("unlink database failure is reported and does not claim success", async () => {
  const { bot, calls } = createHarness({
    lookupTelegramLink: async () => ({ state: "linked", link: ACTIVE_LINK }),
    data: fakeData(),
    unlinkTelegramAccount: async () => ({ ok: false }),
  });

  await deliver(bot, callbackUpdate("unlink_confirm"));

  assert.equal(messageText(firstReply(calls)), UNLINK_FAILED_TEXT);
});

test("unlink lookup failure is reported, not treated as unlinked", async () => {
  let unlinkCalls = 0;
  const { bot, calls } = createHarness({
    lookupTelegramLink: async () => ({ state: "unavailable" }),
    unlinkTelegramAccount: async () => {
      unlinkCalls += 1;
      return { ok: true, data: true };
    },
  });

  await deliver(bot, callbackUpdate("unlink_confirm"));

  assert.equal(unlinkCalls, 0);
  assert.equal(messageText(firstReply(calls)), MERCHANT_LOOKUP_FAILED_TEXT);
});

// ---------------------------------------------------------------------------
// Fallbacks and unexpected input
// ---------------------------------------------------------------------------

test("unknown callback data is answered instead of being ignored", async () => {
  const { bot, calls } = createHarness();
  await deliver(bot, callbackUpdate("legacy_button"));

  const answers = callsOf(calls, "answerCallbackQuery");
  assert.equal(answers.length, 1);
  assert.equal(answers[0].payload.text, UNKNOWN_CALLBACK_TEXT);
  assert.equal(callsOf(calls, "sendMessage").length, 0);
});

test("callback without data is answered with a stale-menu message", async () => {
  const { bot, calls } = createHarness();
  await deliver(bot, callbackUpdate());

  const answers = callsOf(calls, "answerCallbackQuery");
  assert.equal(answers.length, 1);
  assert.equal(answers[0].payload.text, STALE_CALLBACK_TEXT);
  assert.equal(callsOf(calls, "sendMessage").length, 0);
});

test("unexpected free text gets guidance instead of silence", async () => {
  const { bot, calls } = createHarness();
  await deliver(bot, textUpdate("hello there"));

  assert.equal(messageText(firstReply(calls)), FALLBACK_TEXT);
});

test("unknown command gets the command list", async () => {
  const { bot, calls } = createHarness();
  await deliver(bot, textUpdate("/bogus"));

  assert.equal(messageText(firstReply(calls)), UNKNOWN_COMMAND_TEXT);
});

test("non-text message is handled without crashing", async () => {
  const { bot, calls } = createHarness();
  await deliver(bot, photoUpdate());

  assert.equal(messageText(firstReply(calls)), NON_TEXT_MESSAGE_TEXT);
});

test("a button press never produces duplicate replies", async () => {
  for (const action of MENU_ACTIONS) {
    const { bot, calls } = createHarness();
    await deliver(bot, callbackUpdate(action));
    assert.equal(callsOf(calls, "sendMessage").length, 1, `${action} replied more than once`);
    assert.equal(
      callsOf(calls, "answerCallbackQuery").length,
      1,
      `${action} was answered more than once`,
    );
  }
});

// ---------------------------------------------------------------------------
// Telegram linking payload parser
//
// Regression: the `link_` prefix must never be hashed. PayProof stores the
// SHA-256 of the raw token only, so hashing the prefixed string makes
// redeem_telegram_token report invalid_token for a token that does exist.
// ---------------------------------------------------------------------------

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

test("linking payload yields the raw token without the link_ prefix", () => {
  const rawToken = randomBytes(32).toString("base64url");
  const parsed = parseLinkToken(`/start link_${rawToken}`);

  assert.equal(parsed, rawToken, "extracted token must equal the raw token");
  assert.ok(parsed !== null && !parsed.startsWith("link_"));
  assert.equal(sha256(parsed), sha256(rawToken), "hashes must match PayProof's");
});

test("linking payload keeps base64url '-' and '_' characters", () => {
  const rawToken = "ab-_CD_ef-12";
  assert.equal(parseLinkToken(`/start link_${rawToken}`), rawToken);
});

test("malformed and tokenless payloads are rejected", () => {
  const rejected: Array<string | undefined> = [
    undefined,
    "",
    "/start",
    "/start ",
    "/start link_",
    "/start link_abc def",
    "/start link_abc!",
    "/start link_abc/def",
    "/start notlink_abc",
    "/startx link_abc",
    "  /start link_abc",
  ];

  for (const text of rejected) {
    assert.equal(parseLinkToken(text), null, `expected null for ${JSON.stringify(text)}`);
  }
});

test("/start without a linking payload still shows the dashboard", async () => {
  const { bot, calls } = createHarness();
  await deliver(bot, textUpdate("/start"));

  const messages = callsOf(calls, "sendMessage");
  assert.equal(messages.length, 1);
  assert.equal(messageText(messages[0]), MAIN_MENU_TEXT);
});

