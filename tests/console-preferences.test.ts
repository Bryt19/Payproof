import assert from "node:assert/strict";
import test from "node:test";
import {
  CONSOLE_PREFERENCES_KEY,
  DEFAULT_CONSOLE_PREFERENCES,
  applyConsolePreferences,
  consolePreferenceAttributes,
  filterEnabledNotifications,
  formatConsoleAmount,
  formatConsoleDate,
  formatConsoleNumber,
  isNotificationTypeEnabled,
  notificationPreferenceKey,
  readConsolePreferences,
  sanitizeConsolePreferences,
  writeConsolePreferences,
  type ConsolePreferences,
  type NotificationPreferenceKey,
} from "../src/lib/preferences/console-preferences.ts";
import type { NotificationType } from "../src/lib/notifications/types.ts";

function preferences(
  overrides: Partial<Omit<ConsolePreferences, "notifications">> & {
    notifications?: Partial<Record<NotificationPreferenceKey, boolean>>;
  } = {},
): ConsolePreferences {
  return sanitizeConsolePreferences({
    ...DEFAULT_CONSOLE_PREFERENCES,
    ...overrides,
    notifications: {
      ...DEFAULT_CONSOLE_PREFERENCES.notifications,
      ...(overrides.notifications ?? {}),
    },
  });
}

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem(key: string) {
      return data.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      data.set(key, value);
    },
  };
}

function record(type: NotificationType, id = type) {
  return { id, type };
}

// ---------------------------------------------------------------------------
// Persistence and sanitisation
// ---------------------------------------------------------------------------

test("sanitize fills defaults and drops unknown keys", () => {
  const result = sanitizeConsolePreferences({
    compactMode: true,
    theme: "light",
    currency: "usd",
    network: "mainnet",
    autoVerifyOnchain: false,
    notifications: { security: false },
  });

  assert.deepEqual(result, {
    ...DEFAULT_CONSOLE_PREFERENCES,
    compactMode: true,
  });
  assert.equal(result.currency, "sol");
  assert.equal(result.theme, "dark");
  assert.equal("network" in result, false);
  assert.equal("autoVerifyOnchain" in result, false);
});

test("sanitize falls back per field instead of rejecting the whole payload", () => {
  const result = sanitizeConsolePreferences({
    timezone: "Not/AZone",
    dateFormat: "martian",
    numberFormat: "comma",
    reduceMotion: true,
    notifications: {
      paymentReceived: false,
      paymentRequestUpdates: "yes",
      failedTransactions: true,
    },
  });

  assert.equal(result.timezone, DEFAULT_CONSOLE_PREFERENCES.timezone);
  assert.equal(result.dateFormat, DEFAULT_CONSOLE_PREFERENCES.dateFormat);
  assert.equal(result.numberFormat, "comma");
  assert.equal(result.reduceMotion, true);
  assert.equal(result.notifications.paymentReceived, false);
  assert.equal(
    result.notifications.paymentRequestUpdates,
    DEFAULT_CONSOLE_PREFERENCES.notifications.paymentRequestUpdates,
  );
});

test("reading stored preferences merges them with defaults", () => {
  const storage = memoryStorage({
    [CONSOLE_PREFERENCES_KEY]: JSON.stringify({
      compactMode: true,
      notifications: { failedTransactions: false },
    }),
  });

  const result = readConsolePreferences(storage);

  assert.equal(result.compactMode, true);
  assert.equal(result.notifications.failedTransactions, false);
  assert.equal(result.notifications.paymentReceived, true);
});

test("corrupt or unavailable storage never throws", () => {
  assert.deepEqual(
    readConsolePreferences(memoryStorage({ [CONSOLE_PREFERENCES_KEY]: "{" })),
    DEFAULT_CONSOLE_PREFERENCES,
  );

  const throwing = {
    getItem() {
      throw new Error("blocked");
    },
  };

  assert.deepEqual(readConsolePreferences(throwing), DEFAULT_CONSOLE_PREFERENCES);
  assert.deepEqual(readConsolePreferences(null), DEFAULT_CONSOLE_PREFERENCES);
});

test("writing persists the sanitised shape and reports blocked storage", () => {
  const storage = memoryStorage();
  const saved = writeConsolePreferences(
    preferences({ compactMode: true, theme: "dark" }),
    storage,
  );

  assert.equal(saved, true);
  assert.deepEqual(
    JSON.parse(storage.data.get(CONSOLE_PREFERENCES_KEY) ?? "{}"),
    preferences({ compactMode: true }),
  );

  const blocked = {
    getItem() {
      return null;
    },
    setItem() {
      throw new Error("quota");
    },
  };

  assert.equal(writeConsolePreferences(DEFAULT_CONSOLE_PREFERENCES, blocked), false);
  assert.equal(writeConsolePreferences(DEFAULT_CONSOLE_PREFERENCES, null), false);
});

test("document attributes reflect only implemented appearance settings", () => {
  assert.deepEqual(consolePreferenceAttributes(DEFAULT_CONSOLE_PREFERENCES), {
    "data-theme": "dark",
    "data-compact": "false",
    "data-reduce-motion": "false",
  });

  assert.deepEqual(
    consolePreferenceAttributes(
      preferences({ compactMode: true, reduceMotion: true }),
    ),
    {
      "data-theme": "dark",
      "data-compact": "true",
      "data-reduce-motion": "true",
    },
  );

  const attributes = new Map<string, string>();
  applyConsolePreferences(preferences({ compactMode: true }), {
    setAttribute: (name, value) => attributes.set(name, value),
  });

  assert.equal(attributes.get("data-compact"), "true");
  assert.equal(attributes.get("data-reduce-motion"), "false");
  assert.equal(attributes.get("data-theme"), "dark");
});

// ---------------------------------------------------------------------------
// In-app notification feed preferences
// ---------------------------------------------------------------------------

test("notification types map to their Settings category", () => {
  assert.equal(notificationPreferenceKey("payment_received"), "paymentReceived");
  assert.equal(notificationPreferenceKey("payment_failed"), "failedTransactions");
  assert.equal(
    notificationPreferenceKey("payment_request_created"),
    "paymentRequestUpdates",
  );
  assert.equal(
    notificationPreferenceKey("payment_request_expired"),
    "paymentRequestUpdates",
  );
  assert.equal(
    notificationPreferenceKey("payment_request_cancelled"),
    "paymentRequestUpdates",
  );
});

test("disabling a category hides only that category from the feed", () => {
  const all = [
    record("payment_received"),
    record("payment_request_created"),
    record("payment_request_expired"),
    record("payment_request_cancelled"),
    record("payment_failed"),
  ];

  assert.equal(filterEnabledNotifications(all, preferences()).length, 5);

  const noReceived = preferences({
    notifications: { paymentReceived: false },
  });
  const visible = filterEnabledNotifications(all, noReceived);
  assert.equal(visible.some((item) => item.type === "payment_received"), false);
  assert.equal(visible.length, 4);
  assert.equal(isNotificationTypeEnabled("payment_failed", noReceived), true);

  const noUpdates = preferences({
    notifications: { paymentRequestUpdates: false },
  });
  assert.deepEqual(
    filterEnabledNotifications(all, noUpdates).map((item) => item.type),
    ["payment_received", "payment_failed"],
  );

  const noFailures = preferences({
    notifications: { failedTransactions: false },
  });
  assert.deepEqual(
    filterEnabledNotifications(all, noFailures).map((item) => item.type),
    [
      "payment_received",
      "payment_request_created",
      "payment_request_expired",
      "payment_request_cancelled",
    ],
  );
});

// ---------------------------------------------------------------------------
// Display formatting
// ---------------------------------------------------------------------------

const LATE_UTC = "2026-11-07T23:30:00.000Z";

test("date format honours the selected timezone", () => {
  assert.equal(
    formatConsoleDate(LATE_UTC, preferences({ timezone: "Africa/Lagos" })),
    "08/11/2026",
  );
  assert.equal(
    formatConsoleDate(LATE_UTC, preferences({ timezone: "Europe/London" })),
    "07/11/2026",
  );
});

test("each date format renders its advertised shape", () => {
  const base = { timezone: "UTC" } as const;

  assert.equal(
    formatConsoleDate(LATE_UTC, preferences({ ...base, dateFormat: "eu" })),
    "07/11/2026",
  );
  assert.equal(
    formatConsoleDate(LATE_UTC, preferences({ ...base, dateFormat: "us" })),
    "11/07/2026",
  );
  assert.equal(
    formatConsoleDate(LATE_UTC, preferences({ ...base, dateFormat: "iso" })),
    "2026-11-07",
  );
  assert.equal(
    formatConsoleDate(LATE_UTC, preferences({ ...base, dateFormat: "full" })),
    "7 November 2026",
  );
});

test("optional time rendering uses the same timezone", () => {
  assert.equal(
    formatConsoleDate(
      LATE_UTC,
      preferences({ timezone: "Africa/Lagos", dateFormat: "iso" }),
      { includeTime: true },
    ),
    "2026-11-08 00:30",
  );
});

test("invalid dates and timezones fail visibly, never throw", () => {
  assert.equal(formatConsoleDate(null, preferences()), "—");
  assert.equal(formatConsoleDate("not-a-date", preferences()), "—");
  assert.equal(
    formatConsoleDate(LATE_UTC, {
      timezone: "Not/AZone",
      dateFormat: "iso",
    }),
    "2026-11-07",
  );
});

test("number format regroups exact amounts without losing precision", () => {
  assert.equal(formatConsoleNumber("1234.56", "dot"), "1,234.56");
  assert.equal(formatConsoleNumber("1234.56", "comma"), "1.234,56");
  assert.equal(formatConsoleNumber("1234.56", "space"), "1 234.56");
  assert.equal(formatConsoleNumber("1234567.891", "dot"), "1,234,567.891");
  assert.equal(formatConsoleNumber("2", "comma"), "2");
  assert.equal(formatConsoleNumber("0.000000001", "dot"), "0.000000001");
  assert.equal(formatConsoleNumber("—", "dot"), "—");
});

test("amount formatting follows the number-format preference", () => {
  assert.equal(
    formatConsoleAmount("1234.5", preferences({ numberFormat: "comma" })),
    "1.234,5",
  );
});
