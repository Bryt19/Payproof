import type { NotificationType } from "@/lib/notifications/types";

// ---------------------------------------------------------------------------
// Console preferences
//
// One persisted shape shared by the Settings page, the root provider and the
// in-app notification feed. Reading never throws: unavailable or corrupt
// storage falls back to defaults, and unknown keys are dropped so an old
// payload cannot resurrect unsupported controls.
// ---------------------------------------------------------------------------

export const CONSOLE_PREFERENCES_KEY = "payproof_console_settings";

export type DateFormat = "eu" | "us" | "iso" | "full";
export type NumberFormat = "dot" | "comma" | "space";
export type ConsoleTheme = "dark";

export type NotificationPreferenceKey =
  | "paymentReceived"
  | "paymentRequestUpdates"
  | "failedTransactions";

export type ConsolePreferences = {
  /** SOL is the only settlement asset; fiat display is not implemented. */
  currency: "sol";
  timezone: string;
  dateFormat: DateFormat;
  numberFormat: NumberFormat;
  theme: ConsoleTheme;
  compactMode: boolean;
  reduceMotion: boolean;
  /**
   * In-app feed visibility only. Telegram delivery preferences are stored
   * server-side and configured in the Telegram section.
   */
  notifications: Record<NotificationPreferenceKey, boolean>;
};

export const DEFAULT_CONSOLE_PREFERENCES: ConsolePreferences = {
  currency: "sol",
  timezone: "Africa/Lagos",
  dateFormat: "eu",
  numberFormat: "dot",
  theme: "dark",
  compactMode: false,
  reduceMotion: false,
  notifications: {
    paymentReceived: true,
    paymentRequestUpdates: true,
    failedTransactions: true,
  },
};

const DATE_FORMATS: readonly DateFormat[] = ["eu", "us", "iso", "full"];
const NUMBER_FORMATS: readonly NumberFormat[] = ["dot", "comma", "space"];
export const TIMEZONE_OPTIONS = [
  "Africa/Lagos",
  "Africa/Accra",
  "Africa/Nairobi",
  "Africa/Johannesburg",
  "Europe/London",
  "Europe/Berlin",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "Asia/Dubai",
  "Asia/Singapore",
] as const;

/** Minimal storage surface, so tests can pass an in-memory implementation. */
export type PreferenceStorage = {
  getItem(key: string): string | null;
  setItem?(key: string, value: string): void;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** True only when Intl accepts the zone; prevents a bad stored value from throwing later. */
export function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || value.trim().length === 0) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/**
 * Normalises an unknown payload (localStorage JSON or an event detail) into
 * the current shape. Invalid fields fall back individually; unknown keys are
 * ignored.
 */
export function sanitizeConsolePreferences(value: unknown): ConsolePreferences {
  const raw = isRecord(value) ? value : {};
  const notifications = isRecord(raw.notifications) ? raw.notifications : {};

  const dateFormat = DATE_FORMATS.includes(raw.dateFormat as DateFormat)
    ? (raw.dateFormat as DateFormat)
    : DEFAULT_CONSOLE_PREFERENCES.dateFormat;

  const numberFormat = NUMBER_FORMATS.includes(raw.numberFormat as NumberFormat)
    ? (raw.numberFormat as NumberFormat)
    : DEFAULT_CONSOLE_PREFERENCES.numberFormat;

  return {
    currency: "sol",
    timezone: isValidTimeZone(raw.timezone)
      ? (raw.timezone as string)
      : DEFAULT_CONSOLE_PREFERENCES.timezone,
    dateFormat,
    numberFormat,
    theme: "dark",
    compactMode: raw.compactMode === true,
    reduceMotion: raw.reduceMotion === true,
    notifications: {
      paymentReceived:
        typeof notifications.paymentReceived === "boolean"
          ? notifications.paymentReceived
          : DEFAULT_CONSOLE_PREFERENCES.notifications.paymentReceived,
      paymentRequestUpdates:
        typeof notifications.paymentRequestUpdates === "boolean"
          ? notifications.paymentRequestUpdates
          : DEFAULT_CONSOLE_PREFERENCES.notifications.paymentRequestUpdates,
      failedTransactions:
        typeof notifications.failedTransactions === "boolean"
          ? notifications.failedTransactions
          : DEFAULT_CONSOLE_PREFERENCES.notifications.failedTransactions,
    },
  };
}

/** Reads persisted preferences; corrupt or unavailable storage yields defaults. */
export function readConsolePreferences(
  storage: PreferenceStorage | null | undefined,
): ConsolePreferences {
  if (!storage) return DEFAULT_CONSOLE_PREFERENCES;

  try {
    const stored = storage.getItem(CONSOLE_PREFERENCES_KEY);
    if (!stored) return DEFAULT_CONSOLE_PREFERENCES;
    return sanitizeConsolePreferences(JSON.parse(stored));
  } catch {
    return DEFAULT_CONSOLE_PREFERENCES;
  }
}

/** Persists preferences; returns false instead of throwing on blocked storage. */
export function writeConsolePreferences(
  preferences: ConsolePreferences,
  storage: PreferenceStorage | null | undefined,
): boolean {
  if (!storage?.setItem) return false;

  try {
    storage.setItem(
      CONSOLE_PREFERENCES_KEY,
      JSON.stringify(sanitizeConsolePreferences(preferences)),
    );
    return true;
  } catch {
    return false;
  }
}

export type ConsolePreferenceAttributes = {
  "data-theme": ConsoleTheme;
  "data-compact": "true" | "false";
  "data-reduce-motion": "true" | "false";
};

/** Attributes applied to <html>; the inline bootstrap script mirrors this. */
export function consolePreferenceAttributes(
  preferences: ConsolePreferences,
): ConsolePreferenceAttributes {
  return {
    "data-theme": preferences.theme,
    "data-compact": preferences.compactMode ? "true" : "false",
    "data-reduce-motion": preferences.reduceMotion ? "true" : "false",
  };
}

export function applyConsolePreferences(
  preferences: ConsolePreferences,
  root: Pick<HTMLElement, "setAttribute">,
): void {
  const attributes = consolePreferenceAttributes(preferences);
  for (const [name, value] of Object.entries(attributes)) {
    root.setAttribute(name, value);
  }
}

// ---------------------------------------------------------------------------
// In-app notification feed preferences
// ---------------------------------------------------------------------------

/**
 * Maps a stored notification to the Settings toggle that controls it.
 * Every notification type has a category; there are no invoice or security
 * notification types in the system, which is why those rows are informational.
 */
export function notificationPreferenceKey(
  type: NotificationType,
): NotificationPreferenceKey {
  if (type === "payment_received") return "paymentReceived";
  if (type === "payment_failed") return "failedTransactions";
  return "paymentRequestUpdates";
}

export function isNotificationTypeEnabled(
  type: NotificationType,
  preferences: Pick<ConsolePreferences, "notifications">,
): boolean {
  return preferences.notifications[notificationPreferenceKey(type)];
}

/** Keeps only notifications whose category is enabled for the in-app feed. */
export function filterEnabledNotifications<T extends { type: NotificationType }>(
  notifications: readonly T[],
  preferences: Pick<ConsolePreferences, "notifications">,
): T[] {
  return notifications.filter((notification) =>
    isNotificationTypeEnabled(notification.type, preferences),
  );
}

// ---------------------------------------------------------------------------
// Display formatting (dates, times and decimal amounts)
// ---------------------------------------------------------------------------

const DATE_LOCALES: Record<DateFormat, string> = {
  eu: "en-GB",
  us: "en-US",
  iso: "en-CA",
  full: "en-GB",
};

function dateFormatOptions(
  format: DateFormat,
  includeTime: boolean,
): Intl.DateTimeFormatOptions {
  const time: Intl.DateTimeFormatOptions = includeTime
    ? { hour: "2-digit", minute: "2-digit", hour12: false }
    : {};

  if (format === "full") {
    return { day: "numeric", month: "long", year: "numeric", ...time };
  }
  if (format === "iso") {
    return { year: "numeric", month: "2-digit", day: "2-digit", ...time };
  }
  return { day: "2-digit", month: "2-digit", year: "numeric", ...time };
}

/**
 * Formats a timestamp using the saved timezone and date format. Invalid dates
 * render an em dash; an invalid timezone (only possible from outside the app)
 * falls back to UTC rather than throwing during render.
 */
export function formatConsoleDate(
  value: string | null | undefined,
  preferences: Pick<ConsolePreferences, "timezone" | "dateFormat">,
  options: { includeTime?: boolean } = {},
): string {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";

  const timeZone = isValidTimeZone(preferences.timezone)
    ? preferences.timezone
    : "UTC";
  const includeTime = options.includeTime === true;

  try {
    // ISO is assembled from parts so a runtime locale fallback cannot change
    // the separator or field order.
    if (preferences.dateFormat === "iso") {
      const parts = new Intl.DateTimeFormat("en-US", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        ...(includeTime
          ? { hour: "2-digit", minute: "2-digit", hour12: false }
          : {}),
        timeZone,
      }).formatToParts(date);
      const lookup = (type: string) =>
        parts.find((part) => part.type === type)?.value ?? "";
      const day = `${lookup("year")}-${lookup("month")}-${lookup("day")}`;
      if (!includeTime) return day;
      const hour = lookup("hour") === "24" ? "00" : lookup("hour");
      return `${day} ${hour}:${lookup("minute")}`;
    }

    return new Intl.DateTimeFormat(DATE_LOCALES[preferences.dateFormat], {
      ...dateFormatOptions(preferences.dateFormat, includeTime),
      timeZone,
    }).format(date);
  } catch {
    return "—";
  }
}

const GROUP_SEPARATORS: Record<NumberFormat, { group: string; decimal: string }> = {
  dot: { group: ",", decimal: "." },
  comma: { group: ".", decimal: "," },
  space: { group: " ", decimal: "." },
};

/**
 * Re-groups an already-exact decimal string (for example `1234.5` from
 * formatSolExact) without changing its precision. Non-decimal values are
 * returned untouched.
 */
export function formatConsoleNumber(
  value: string,
  format: NumberFormat,
): string {
  if (!/^-?\d+(?:\.\d+)?$/.test(value)) return value;

  const separators = GROUP_SEPARATORS[format] ?? GROUP_SEPARATORS.dot;
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [whole, fraction] = unsigned.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, separators.group);

  return `${negative ? "-" : ""}${grouped}${
    fraction === undefined ? "" : separators.decimal + fraction
  }`;
}

/** Formats an exact SOL amount string for tables and detail views. */
export function formatConsoleAmount(
  amountSol: string,
  preferences: Pick<ConsolePreferences, "numberFormat">,
): string {
  return formatConsoleNumber(amountSol, preferences.numberFormat);
}
