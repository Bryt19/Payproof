import assert from "node:assert/strict";
import test from "node:test";
import { Bot, type Transformer } from "grammy";
import type { Update } from "grammy/types";

import {
  DATA_UNAVAILABLE_TEXT,
  FALLBACK_TEXT,
  MERCHANT_LOOKUP_FAILED_TEXT,
  NOTIFICATIONS_TEXT,
  PREFERENCE_SAVE_FAILED_TEXT,
  SETTINGS_TEXT,
  STALE_CALLBACK_TEXT,
  UNKNOWN_CALLBACK_TEXT,
  mainMenuKeyboard,
  registerHandlers,
  type HandlerDependencies,
  type MenuAction,
} from "../src/handlers.js";
import {
  NOTIF_TEST_ACTION,
  NOTIFICATION_EVENT_TYPES,
  buildNotificationPreferencesKeyboard,
  buildNotificationPreferencesText,
  isNotificationEventType,
  parseToggleCallbackData,
  type NotificationEventType,
  type NotificationPreferenceStore,
} from "../src/lib/notification-preferences.js";
import { sendTestNotificationToMerchant } from "../src/lib/telegram-notify.js";
import { fakeData, ACTIVE_LINK, CHAT_ID, FROM, MERCHANT_WALLET } from "./fixtures.js";

// ---------------------------------------------------------------------------
// Harness
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

const CALLBACK_ID = "cb-1";

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
    else if (method === "sendMessage" || method === "editMessageText") {
      result = { message_id: calls.length, date: 0, chat: { id: CHAT_ID, type: "private" } };
    }
    return { ok: true, result };
  }) as unknown as Transformer;

  bot.api.config.use(transformer);

  const resolved: HandlerDependencies = {
    lookupTelegramLink: async () => ({ state: "not_linked" }),
    data: fakeData(),
    unlinkTelegramAccount: async () => ({ ok: false }),
    notificationPreferences: memoryStore(),
    sendTestNotification: async () => ({ ok: true }),
    ...deps,
  };

  registerHandlers(bot, resolved);
  return { bot, calls };
}

function memoryStore(
  initial: Partial<Record<NotificationEventType, boolean | null>> = {},
): NotificationPreferenceStore & {
  writes: Array<{
    merchantAddress: string;
    eventType: NotificationEventType;
    enabled: boolean;
  }>;
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
    writes,
    async getAll(merchantAddress) {
      return { ...(state.get(merchantAddress) ?? { ...empty(), ...initial }) };
    },
    async set(merchantAddress, eventType, enabled) {
      const current = state.get(merchantAddress) ?? { ...empty(), ...initial };
      state.set(merchantAddress, { ...current, [eventType]: enabled });
      writes.push({ merchantAddress, eventType, enabled });
      return true;
    },
  };
}

async function deliver(bot: Bot, update: Update): Promise<void> {
  await bot.init();
  await bot.handleUpdate(update);
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
        text: "screen",
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

function callsOf(calls: ApiCall[], method: string): ApiCall[] {
  return calls.filter((call) => call.method === method);
}

function messageText(call: ApiCall | undefined): string {
  return call && typeof call.payload.text === "string" ? call.payload.text : "";
}

function markupOf(call: ApiCall | undefined): string {
  return JSON.stringify(call?.payload.reply_markup ?? {});
}

function linkedHarness(
  store: NotificationPreferenceStore,
  extra: HandlerDependencies = {},
) {
  return createHarness({
    lookupTelegramLink: async () => ({ state: "linked", link: ACTIVE_LINK }),
    data: fakeData(),
    notificationPreferences: store,
    ...extra,
  });
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

test("only the known event types are accepted as toggle targets", () => {
  for (const eventType of NOTIFICATION_EVENT_TYPES) {
    assert.equal(parseToggleCallbackData(`notif_toggle:${eventType}`), eventType);
  }

  for (const forged of [
    "notif_toggle:admin",
    "notif_toggle:payment_received ",
    "notif_toggle:PAYMENT_RECEIVED",
    "notif_toggle:",
    "notifications",
    "notif_toggle::payment_received",
    undefined,
  ]) {
    assert.equal(parseToggleCallbackData(forged), null, `accepted ${forged}`);
  }
});

test("isNotificationEventType narrows unknown strings", () => {
  assert.equal(isNotificationEventType("payment_received"), true);
  assert.equal(isNotificationEventType("payment_refunded"), false);
  assert.equal(isNotificationEventType(7), false);
});

test("unset preferences render as not set and are never implied enabled", () => {
  const text = buildNotificationPreferencesText({
    payment_request_created: null,
    payment_received: null,
    payment_failed: null,
    payment_request_expired: null,
    payment_request_cancelled: null,
  });

  assert.match(text, /count as disabled/i);
  assert.doesNotMatch(text, /Enabled/);
});

test("keyboard carries a toggle per event plus the explicit test action", () => {
  const markup = JSON.stringify(
    buildNotificationPreferencesKeyboard({
      payment_request_created: false,
      payment_received: true,
      payment_failed: true,
      payment_request_expired: null,
      payment_request_cancelled: false,
    }),
  );

  for (const eventType of NOTIFICATION_EVENT_TYPES) {
    assert.ok(markup.includes(`notif_toggle:${eventType}`));
  }
  assert.ok(markup.includes(NOTIF_TEST_ACTION));
  assert.ok(markup.includes('"main_menu"'));
});

test("the dashboard keyboard lists every menu action for its linking state", () => {
  const linkedMarkup = JSON.stringify(mainMenuKeyboard(true));
  const unlinkedMarkup = JSON.stringify(mainMenuKeyboard(false));

  const shared: MenuAction[] = [
    "payment_summary",
    "transactions",
    "pending",
    "receipts",
    "notifications",
    "settings",
    "account_status",
  ];

  for (const action of shared) {
    assert.ok(linkedMarkup.includes(`"${action}"`), `missing ${action} for linked`);
    assert.ok(unlinkedMarkup.includes(`"${action}"`), `missing ${action} for unlinked`);
  }

  assert.ok(linkedMarkup.includes('"help"'), "linked dashboard must offer Help");
  assert.ok(unlinkedMarkup.includes('"help"'), "unlinked dashboard must offer Help");

  // Connect and Unlink share a slot; Balance only exists for linked merchants.
  assert.ok(unlinkedMarkup.includes('"connect"'), "unlinked must offer Connect");
  assert.ok(!unlinkedMarkup.includes('"unlink"'), "unlinked must not offer Unlink");
  assert.ok(!unlinkedMarkup.includes('"balance"'), "unlinked must not offer Balance");

  assert.ok(linkedMarkup.includes('"unlink"'), "linked must offer Unlink");
  assert.ok(linkedMarkup.includes('"balance"'), "linked must offer Balance");
  assert.ok(!linkedMarkup.includes('"connect"'), "linked must not offer Connect");
});

// ---------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------

test("linked notifications screen shows all saved states and toggles", async () => {
  const store = memoryStore({
    payment_received: true,
    payment_request_expired: false,
  });
  const { bot, calls } = linkedHarness(store);

  await deliver(bot, callbackUpdate("notifications"));

  const reply = callsOf(calls, "sendMessage")[0];
  const text = messageText(reply);
  const markup = markupOf(reply);

  assert.match(text, /Payment received: Enabled/);
  assert.match(text, /Payment failed: Not set/);
  assert.match(text, /Request expired: Disabled/);
  assert.match(text, /Request created: Not set/);
  assert.match(text, /Request cancelled: Not set/);

  for (const eventType of NOTIFICATION_EVENT_TYPES) {
    assert.ok(markup.includes(`notif_toggle:${eventType}`));
  }
  assert.ok(markup.includes(NOTIF_TEST_ACTION));
});

test("linked settings screen shows saved state and links to notifications", async () => {
  const store = memoryStore({ payment_received: true });
  const { bot, calls } = linkedHarness(store);

  await deliver(bot, callbackUpdate("settings"));

  const reply = callsOf(calls, "sendMessage")[0];
  const text = messageText(reply);
  assert.match(text, /Merchant account: Linked/);
  assert.ok(text.includes(MERCHANT_WALLET));
  assert.match(text, /Payment received: Enabled/);
  assert.match(text, /Request created: Not set/);
  assert.ok(markupOf(reply).includes('"notifications"'));
});

test("unlinked notifications screen offers linking and no toggles", async () => {
  const { bot, calls } = createHarness();

  await deliver(bot, callbackUpdate("notifications"));

  const reply = callsOf(calls, "sendMessage")[0];
  assert.equal(messageText(reply), NOTIFICATIONS_TEXT);
  assert.match(messageText(reply), /never triggered by a browser request/i);

  const markup = markupOf(reply);
  assert.doesNotMatch(markup, /notif_toggle:/);
  assert.ok(markup.includes('"connect"'));
});

test("unlinked settings screen is the honest unlinked text", async () => {
  const { bot, calls } = createHarness();

  await deliver(bot, callbackUpdate("settings"));

  assert.equal(messageText(callsOf(calls, "sendMessage")[0]), SETTINGS_TEXT);
});

test("lookup failure never shows the unlinked screen", async () => {
  const { bot, calls } = createHarness({
    lookupTelegramLink: async () => ({ state: "unavailable" }),
  });

  await deliver(bot, callbackUpdate("notifications"));

  const reply = callsOf(calls, "sendMessage")[0];
  assert.equal(messageText(reply), MERCHANT_LOOKUP_FAILED_TEXT);
  assert.doesNotMatch(markupOf(reply), /notif_toggle:/);
});

test("/notifications from an unlinked chat never claims saved preferences", async () => {
  const { bot, calls } = createHarness();
  await deliver(bot, textUpdate("/notifications"));

  const text = messageText(callsOf(calls, "sendMessage")[0]);
  assert.doesNotMatch(text, /Enabled|Disabled:/);
  assert.match(text, /Link your PayProof account/i);
});

// ---------------------------------------------------------------------------
// Toggles
// ---------------------------------------------------------------------------

test("toggling persists the change and redraws the saved state", async () => {
  const store = memoryStore();
  const { bot, calls } = linkedHarness(store);

  await deliver(bot, callbackUpdate("notif_toggle:payment_received"));

  assert.deepEqual(store.writes, [
    {
      merchantAddress: MERCHANT_WALLET,
      eventType: "payment_received",
      enabled: true,
    },
  ]);

  const edit = callsOf(calls, "editMessageText")[0];
  assert.ok(edit, "the screen must refresh after a toggle");
  assert.match(messageText(edit), /Payment received: Enabled/);
  assert.ok(markupOf(edit).includes("notif_toggle:payment_received"));
});

test("toggling an enabled preference turns it off", async () => {
  const store = memoryStore({ payment_received: true });
  const { bot, calls } = linkedHarness(store);

  await deliver(bot, callbackUpdate("notif_toggle:payment_received"));

  assert.equal(store.writes.length, 1);
  assert.equal(store.writes[0].enabled, false);
  assert.match(
    messageText(callsOf(calls, "editMessageText")[0]),
    /Payment received: Disabled/,
  );
});

test("each event type toggles independently", async () => {
  const store = memoryStore();
  const { bot } = linkedHarness(store);

  for (const eventType of NOTIFICATION_EVENT_TYPES) {
    await deliver(bot, callbackUpdate(`notif_toggle:${eventType}`));
  }

  const enabled: NotificationEventType[] = store.writes
    .filter((write) => write.enabled)
    .map((write) => write.eventType);

  assert.deepEqual(enabled, [...NOTIFICATION_EVENT_TYPES]);
});

test("a failed save is reported and nothing is redrawn", async () => {
  const failing: NotificationPreferenceStore = {
    getAll: async () => ({
      payment_request_created: null,
      payment_received: null,
      payment_failed: null,
      payment_request_expired: null,
      payment_request_cancelled: null,
    }),
    set: async () => false,
  };
  const { bot, calls } = linkedHarness(failing);

  await deliver(bot, callbackUpdate("notif_toggle:payment_received"));

  const [answer] = callsOf(calls, "answerCallbackQuery");
  assert.equal(answer.payload.text, PREFERENCE_SAVE_FAILED_TEXT);
  assert.equal(callsOf(calls, "editMessageText").length, 0);
  assert.equal(callsOf(calls, "sendMessage").length, 0);
});

test("forged toggle data is rejected before any read or write", async () => {
  const store = memoryStore();
  let reads = 0;
  const counting: NotificationPreferenceStore = {
    getAll: async (address) => {
      reads += 1;
      return store.getAll(address);
    },
    set: async (address, eventType, enabled) => {
      return store.set(address, eventType, enabled);
    },
  };
  const { bot, calls } = linkedHarness(counting);

  for (const data of [
    "notif_toggle:admin_override",
    "notif_toggle:payment_received;merchant=attacker",
    "notif_toggle:PAYMENT_RECEIVED",
    "notif_toggle:",
  ]) {
    await deliver(bot, callbackUpdate(data));
  }

  assert.equal(reads, 0, "forged data must not reach the store");
  assert.equal(store.writes.length, 0);

  const answers = callsOf(calls, "answerCallbackQuery");
  assert.equal(answers.length, 4);
  for (const answer of answers) {
    // Rejected either as an unknown option or as stale data; never accepted.
    assert.match(String(answer.payload.text), /not available yet|out of date/i);
  }
});

test("stale callback data (no payload) is answered safely", async () => {
  const store = memoryStore();
  const { bot, calls } = linkedHarness(store);

  await deliver(bot, callbackUpdate());

  assert.equal(store.writes.length, 0);
  const [answer] = callsOf(calls, "answerCallbackQuery");
  assert.equal(answer.payload.text, STALE_CALLBACK_TEXT);
});

test("a toggle from an unlinked chat writes nothing", async () => {
  const store = memoryStore();
  const { bot, calls } = createHarness({ notificationPreferences: store });

  await deliver(bot, callbackUpdate("notif_toggle:payment_received"));

  assert.equal(store.writes.length, 0);
  assert.match(
    String(callsOf(calls, "answerCallbackQuery")[0].payload.text),
    /No linked merchant account/i,
  );
});

test("merchant isolation: every write targets the linked wallet", async () => {
  const store = memoryStore();
  const { bot } = linkedHarness(store);

  await deliver(bot, callbackUpdate("notif_toggle:payment_request_created"));
  await deliver(bot, callbackUpdate("notif_toggle:payment_request_cancelled"));

  assert.equal(store.writes.length, 2);
  for (const write of store.writes) {
    assert.equal(write.merchantAddress, MERCHANT_WALLET);
  }
});

test("enabling a preference never sends a message by itself", async () => {
  const store = memoryStore();
  let testSends = 0;
  const { bot, calls } = linkedHarness(store, {
    sendTestNotification: async () => {
      testSends += 1;
      return { ok: true };
    },
  });

  await deliver(bot, callbackUpdate("notif_toggle:payment_received"));

  assert.equal(testSends, 0);
  assert.equal(callsOf(calls, "sendMessage").length, 0);
  assert.equal(callsOf(calls, "editMessageText").length, 1);
});

// ---------------------------------------------------------------------------
// Explicit test send
// ---------------------------------------------------------------------------

test("the explicit test action sends once to the linked wallet", async () => {
  const store = memoryStore();
  const sentTo: string[] = [];
  const { bot, calls } = linkedHarness(store, {
    sendTestNotification: async (merchantAddress) => {
      sentTo.push(merchantAddress);
      return { ok: true };
    },
  });

  await deliver(bot, callbackUpdate(NOTIF_TEST_ACTION));

  assert.deepEqual(sentTo, [MERCHANT_WALLET]);
  assert.match(
    String(callsOf(calls, "answerCallbackQuery")[0].payload.text),
    /Test message sent/i,
  );
  assert.match(messageText(callsOf(calls, "sendMessage")[0]), /not a payment record/i);
});

test("a failed test send is reported, not claimed as success", async () => {
  const store = memoryStore();
  const { bot, calls } = linkedHarness(store, {
    sendTestNotification: async () => ({
      ok: false,
      message: "TELEGRAM_BOT_TOKEN is not configured.",
    }),
  });

  await deliver(bot, callbackUpdate(NOTIF_TEST_ACTION));

  assert.match(
    String(callsOf(calls, "answerCallbackQuery")[0].payload.text),
    /failed/i,
  );
  assert.match(messageText(callsOf(calls, "sendMessage")[0]), /not sent/i);
});

test("the test action from an unlinked chat sends nothing", async () => {
  let testSends = 0;
  const { bot } = createHarness({
    sendTestNotification: async () => {
      testSends += 1;
      return { ok: true };
    },
  });

  await deliver(bot, callbackUpdate(NOTIF_TEST_ACTION));

  assert.equal(testSends, 0);
});

// ---------------------------------------------------------------------------
// Bot-side test sender
// ---------------------------------------------------------------------------

test("the bot test sender refuses without a bot token", async () => {
  const result = await sendTestNotificationToMerchant(MERCHANT_WALLET, {
    readBotToken: () => null,
    resolveChatId: async () => {
      throw new Error("must not resolve a chat without a token");
    },
    fetchImpl: (async () => {
      throw new Error("network must not be reached");
    }) as unknown as typeof fetch,
  });

  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.message, /not configured/i);
});

test("the bot test sender refuses without an active link", async () => {
  const result = await sendTestNotificationToMerchant(MERCHANT_WALLET, {
    readBotToken: () => "12345:test-token",
    resolveChatId: async () => null,
    fetchImpl: (async () => {
      throw new Error("network must not be reached");
    }) as unknown as typeof fetch,
  });

  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.message, /no active Telegram link/i);
});

test("the bot test sender reports a Telegram rejection", async () => {
  const result = await sendTestNotificationToMerchant(MERCHANT_WALLET, {
    readBotToken: () => "12345:test-token",
    resolveChatId: async () => "42",
    fetchImpl: (async () =>
      new Response(
        JSON.stringify({
          ok: false,
          description: "Forbidden: bot was blocked by the user",
        }),
        { status: 403 },
      )) as unknown as typeof fetch,
  });

  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.message, /blocked/i);
});

test("the bot test sender posts MarkdownV2 test text that is marked as a test", async () => {
  let body: Record<string, unknown> | null = null;
  const result = await sendTestNotificationToMerchant(MERCHANT_WALLET, {
    readBotToken: () => "12345:test-token",
    resolveChatId: async () => "42",
    fetchImpl: (async (_url: unknown, init: unknown) => {
      body = JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ ok: true, result: { message_id: 99 } }), {
        status: 200,
      });
    }) as unknown as typeof fetch,
  });

  assert.equal(result.ok, true);
  assert.ok(body);
  const payload = body as Record<string, unknown>;
  assert.equal(payload.chat_id, "42");
  assert.equal(payload.parse_mode, "MarkdownV2");
  assert.match(String(payload.text), /test message/i);
  assert.match(String(payload.text), /No payment was verified/i);
  // Escaped MarkdownV2: a bare "." would be rejected by Telegram.
  assert.match(String(payload.text), /working for this chat\\\./);
});
