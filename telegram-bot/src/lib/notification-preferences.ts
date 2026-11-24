import type { SupabaseClient } from "@supabase/supabase-js";
import { InlineKeyboard } from "grammy";

import { createSupabaseClient } from "./payment-requests/supabase.js";

/**
 * Per-merchant Telegram notification preferences.
 *
 * Storage lives in `notification_preferences`, keyed by
 * `(merchant_address, event_type)`. A missing row means "disabled", except for
 * `payment_failed`, which defaults to enabled like the web Settings page so a
 * genuine failure is never silently hidden from a linked merchant.
 */

export const NOTIFICATION_EVENT_TYPES = [
  "payment_request_created",
  "payment_received",
  "payment_failed",
  "payment_request_expired",
  "payment_request_cancelled",
] as const;

export type NotificationEventType = (typeof NOTIFICATION_EVENT_TYPES)[number];

export type NotificationPreferences = Record<
  NotificationEventType,
  boolean | null
>;

export const EVENT_LABELS: Record<NotificationEventType, string> = {
  payment_request_created: "Request created",
  payment_received: "Payment received",
  payment_failed: "Payment failed",
  payment_request_expired: "Request expired",
  payment_request_cancelled: "Request cancelled",
};

export const EVENT_DESCRIPTIONS: Record<NotificationEventType, string> = {
  payment_request_created: "a new payment request is created",
  payment_received: "a payment is verified on Solana",
  payment_failed: "a payment attempt reaches failed",
  payment_request_expired: "a request expires unpaid",
  payment_request_cancelled: "a request is cancelled",
};

/** Callback data prefix for a preference toggle: `notif_toggle:<event_type>`. */
export const NOTIF_TOGGLE_PREFIX = "notif_toggle:";

/** Callback data for the explicit test send. */
export const NOTIF_TEST_ACTION = "notif_test";

/** Callback data for refreshing the notification screen. */
export const NOTIF_REFRESH_ACTION = "notifications";

/** Narrow an arbitrary string to a supported event type. */
export function isNotificationEventType(
  value: unknown,
): value is NotificationEventType {
  return (
    typeof value === "string" &&
    (NOTIFICATION_EVENT_TYPES as readonly string[]).includes(value)
  );
}

/**
 * Parse `notif_toggle:<event_type>`.
 * Returns null for anything else, including forged event names.
 */
export function parseToggleCallbackData(
  data: string | undefined,
): NotificationEventType | null {
  if (typeof data !== "string" || !data.startsWith(NOTIF_TOGGLE_PREFIX)) {
    return null;
  }
  const eventType = data.slice(NOTIF_TOGGLE_PREFIX.length);
  return isNotificationEventType(eventType) ? eventType : null;
}

/** Preference state store, injectable so handlers are testable without a DB. */
export type NotificationPreferenceStore = {
  /** Read all preferences for a merchant wallet. */
  getAll(merchantAddress: string): Promise<NotificationPreferences>;
  /** Persist one preference; resolves true when the write succeeded. */
  set(
    merchantAddress: string,
    eventType: NotificationEventType,
    enabled: boolean,
  ): Promise<boolean>;
};

function emptyPreferences(): NotificationPreferences {
  return {
    payment_request_created: null,
    payment_received: null,
    payment_failed: true,
    payment_request_expired: null,
    payment_request_cancelled: null,
  };
}

function logSupabaseError(operation: string, error: { code?: string; message: string }): void {
  console.error(
    `[notification-preferences] ${operation} failed: code=${error.code ?? "unknown"} message=${error.message}`,
  );
}

/**
 * Supabase-backed preference store.
 *
 * The service-role client is created inside the bot process only; the wallet
 * address always comes from the caller's resolved Telegram link, never from
 * callback data.
 */
export function createNotificationPreferenceStore(
  clientFactory: () => SupabaseClient = createSupabaseClient,
): NotificationPreferenceStore {
  return {
    async getAll(merchantAddress: string): Promise<NotificationPreferences> {
      const preferences = emptyPreferences();

      try {
        const supabase = clientFactory();
        const { data, error } = await supabase
          .from("notification_preferences")
          .select("event_type, enabled")
          .eq("merchant_address", merchantAddress);

        if (error) {
          logSupabaseError("read preferences", error);
          return preferences;
        }

        for (const row of data ?? []) {
          const eventType = (row as { event_type?: unknown }).event_type;
          if (!isNotificationEventType(eventType)) continue;
          preferences[eventType] =
            (row as { enabled?: unknown }).enabled === true;
        }

        return preferences;
      } catch (cause) {
        console.error(
          "[notification-preferences] read preferences threw:",
          cause instanceof Error ? cause.message : "unknown error",
        );
        return preferences;
      }
    },

    async set(
      merchantAddress: string,
      eventType: NotificationEventType,
      enabled: boolean,
    ): Promise<boolean> {
      try {
        const supabase = clientFactory();
        const { error } = await supabase
          .from("notification_preferences")
          .upsert(
            {
              merchant_address: merchantAddress,
              event_type: eventType,
              enabled,
            },
            { onConflict: "merchant_address,event_type" },
          );

        if (error) {
          logSupabaseError(`write preference ${eventType}`, error);
          return false;
        }

        return true;
      } catch (cause) {
        console.error(
          "[notification-preferences] write preference threw:",
          cause instanceof Error ? cause.message : "unknown error",
        );
        return false;
      }
    },
  };
}

function stateLabel(state: boolean | null): string {
  if (state === true) return "Enabled";
  if (state === false) return "Disabled";
  return "Not set";
}

function buttonState(state: boolean | null): string {
  return state === true ? "ON" : "OFF";
}

/** Screen text for a linked merchant. */
export function buildNotificationPreferencesText(
  preferences: NotificationPreferences,
): string {
  const lines = [
    "🔔 Payment notifications",
    "",
    "Choose which events PayProof sends to this Telegram chat. Changes are saved immediately.",
    "",
  ];

  for (const eventType of NOTIFICATION_EVENT_TYPES) {
    lines.push(
      `• ${EVENT_LABELS[eventType]}: ${stateLabel(preferences[eventType])} — when ${EVENT_DESCRIPTIONS[eventType]}`,
    );
  }

  lines.push("");
  lines.push(
    "Alerts are only sent after PayProof verifies the event on its server. Missing preferences count as disabled.",
  );

  return lines.join("\n");
}

/** Unlinked screen text: nothing to toggle and no invented state. */
export const NOTIFICATIONS_UNLINKED_TEXT = `🔔 Payment notifications

No PayProof merchant account is linked to this chat, so there are no notification preferences to show.

Link your PayProof account from the app, then open /notifications again.`;

/** Inline keyboard with one toggle per event type. */
export function buildNotificationPreferencesKeyboard(
  preferences: NotificationPreferences,
): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  for (const eventType of NOTIFICATION_EVENT_TYPES) {
    keyboard
      .text(
        `${buttonState(preferences[eventType])} — ${EVENT_LABELS[eventType]}`,
        `${NOTIF_TOGGLE_PREFIX}${eventType}`,
      )
      .row();
  }

  keyboard.text("Send test message", NOTIF_TEST_ACTION).row();
  keyboard.text("🔄 Refresh", NOTIF_REFRESH_ACTION).row();
  keyboard.text("🔙 Back to Menu", "main_menu");

  return keyboard;
}
