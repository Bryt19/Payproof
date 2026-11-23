import type { NotificationType } from "./types";

/**
 * Server-only Telegram delivery for PayProof notifications.
 *
 * Design notes:
 * - `TELEGRAM_BOT_TOKEN` is read from `process.env` inside this module. It is
 *   never returned to a caller, logged, or included in an API response.
 * - Messages use Telegram's MarkdownV2 parse mode, so every dynamic value is
 *   escaped with `escapeMarkdownV2` before it is interpolated.
 * - A single logical delivery maps to one in-app notification
 *   (`notification_id`). Telegram has no idempotency key on the Bot API, so
 *   delivery is at-least-once at best and never exactly-once: if a request
 *   times out after Telegram accepted it, the message may exist while PayProof
 *   records a failure. `deliveryUncertain` marks that case explicitly.
 * - Retries are bounded (3 attempts) and run inside the calling request. They
 *   are NOT durable: nothing re-drives a failed delivery after the process
 *   returns. See `docs`/report for the durable-retry caveat.
 */

export const TELEGRAM_API_BASE = "https://api.telegram.org";
export const MAX_DELIVERY_ATTEMPTS = 3;
export const TELEGRAM_REQUEST_TIMEOUT_MS = 10_000;

export type TelegramDeliveryResult =
  | {
      status: "delivered";
      attempts: number;
      telegramMessageId: string;
    }
  | {
      status: "failed";
      attempts: number;
      errorMessage: string;
      permanent: boolean;
      /**
       * True when the request may have reached Telegram before failing
       * (timeout / aborted socket). Telegram may have delivered the message.
       */
      deliveryUncertain: boolean;
    };

/** Telegram Bot API error shape, narrowed to the fields we use. */
type TelegramApiErrorBody = {
  ok?: boolean;
  error_code?: number;
  description?: string;
  parameters?: { retry_after?: number };
};

/**
 * Escape MarkdownV2 reserved characters.
 * See https://core.telegram.org/bots/api#markdownv2-style
 * Characters that must be escaped: _ * [ ] ( ) ~ ` > # + - = | { } . !
 */
export function escapeMarkdownV2(value: string): string {
  return value.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, "\\$&");
}

export type TelegramMessagePayload = {
  /** Payment request reference, e.g. "PP-8F2K...". */
  reference: string;
  /** Lamports as a decimal string; formatted for display. */
  amountLamports?: string;
  /** Verified Solana transaction signature. */
  transactionSignature?: string;
  /** Short human description of the payment request. */
  description?: string;
  /** Payment status for lifecycle events, e.g. "Failed". */
  status?: string;
};

const EVENT_HEADINGS: Record<NotificationType, string> = {
  payment_request_created: "New payment request",
  payment_received: "Payment verified",
  payment_failed: "Payment failed",
  payment_request_expired: "Payment request expired",
  payment_request_cancelled: "Payment request cancelled",
};

const EVENT_FOOTERS: Record<NotificationType, string> = {
  payment_request_created: "Share the payment request with your customer.",
  payment_received: "Verified on Solana by PayProof. No action is required.",
  payment_failed: "This payment was not completed. No SOL was moved.",
  payment_request_expired: "No verified payment was received before expiry.",
  payment_request_cancelled: "This request can no longer be paid.",
};

export function formatLamportsForTelegram(amountLamports: string): string {
  try {
    const lamports = BigInt(amountLamports);
    const whole = lamports / 1_000_000_000n;
    const fraction = lamports % 1_000_000_000n;
    if (fraction === 0n) {
      return whole.toString();
    }
    const padded = fraction.toString().padStart(9, "0").replace(/0+$/, "");
    return `${whole.toString()}.${padded}`;
  } catch {
    return "0";
  }
}

/**
 * Build the MarkdownV2 body for one notification event.
 * Every interpolated value is escaped; the static template uses only the
 * escapes MarkdownV2 requires for the characters it contains.
 */
export function buildTelegramNotificationText(
  eventType: NotificationType,
  payload: TelegramMessagePayload,
  options: { test?: boolean } = {},
): string {
  const lines: string[] = [];

  const heading = escapeMarkdownV2(EVENT_HEADINGS[eventType]);
  lines.push(`*PayProof — ${heading}*`);

  if (options.test) {
    lines.push(escapeMarkdownV2("TEST MESSAGE — no payment was verified."));
  }

  lines.push("");
  lines.push(`*Reference:* ${escapeMarkdownV2(payload.reference)}`);

  if (payload.amountLamports !== undefined) {
    const amount = formatLamportsForTelegram(payload.amountLamports);
    lines.push(`*Amount:* ${escapeMarkdownV2(`${amount} SOL`)}`);
  }

  if (payload.description !== undefined && payload.description.trim().length > 0) {
    lines.push(`*Description:* ${escapeMarkdownV2(payload.description.trim())}`);
  }

  if (payload.status !== undefined && payload.status.trim().length > 0) {
    lines.push(`*Status:* ${escapeMarkdownV2(payload.status.trim())}`);
  }

  if (payload.transactionSignature !== undefined) {
    lines.push(`*Transaction:* ${escapeMarkdownV2(payload.transactionSignature)}`);
  }

  lines.push("");
  lines.push(escapeMarkdownV2(EVENT_FOOTERS[eventType]));

  if (options.test) {
    lines.push(escapeMarkdownV2("Delivery channel check only."));
  }

  return lines.join("\n");
}

type SendOutcome =
  | { ok: true; messageId: string }
  | {
      ok: false;
      /** HTTP status, or null when the request never completed. */
      httpStatus: number | null;
      errorMessage: string;
      retryAfterSeconds?: number;
      retryable: boolean;
      deliveryUncertain: boolean;
    };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, ms));
  });
}

/** Read `TELEGRAM_BOT_TOKEN` from the server environment only. */
export function readTelegramBotToken(): string | null {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (typeof token !== "string") return null;
  const trimmed = token.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export type TelegramSendOptions = {
  /** Base delay for exponential backoff; attempt 1 waits `base * 2^0`. */
  baseBackoffMs?: number;
  /** Override for tests. Defaults to `globalThis.fetch`. */
  fetchImpl?: typeof fetch;
  /** Override for tests. Defaults to a real timer. */
  sleepImpl?: (ms: number) => Promise<void>;
  timeoutMs?: number;
};

/**
 * POST one `sendMessage` call. Never throws: all failures are returned.
 */
async function sendTelegramMessage(input: {
  botToken: string;
  chatId: string | number;
  text: string;
  options: TelegramSendOptions;
}): Promise<SendOutcome> {
  const fetchImpl = input.options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = input.options.timeoutMs ?? TELEGRAM_REQUEST_TIMEOUT_MS;

  if (typeof fetchImpl !== "function") {
    return {
      ok: false,
      httpStatus: null,
      errorMessage: "fetch is not available in this runtime",
      retryable: false,
      deliveryUncertain: false,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(
      `${TELEGRAM_API_BASE}/bot${input.botToken}/sendMessage`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          chat_id: input.chatId,
          text: input.text,
          parse_mode: "MarkdownV2",
          disable_web_page_preview: true,
        }),
      },
    );

    const rawBody = await response.text();

    if (response.ok) {
      try {
        const parsed = JSON.parse(rawBody) as {
          ok?: boolean;
          result?: { message_id?: number };
        };
        const messageId = parsed.result?.message_id;
        if (typeof messageId === "number") {
          return { ok: true, messageId: String(messageId) };
        }
        return {
          ok: false,
          httpStatus: response.status,
          errorMessage: "Telegram response did not include a message_id",
          retryable: false,
          deliveryUncertain: true,
        };
      } catch {
        return {
          ok: false,
          httpStatus: response.status,
          errorMessage: "Telegram response was not valid JSON",
          retryable: false,
          deliveryUncertain: true,
        };
      }
    }

    let parsed: TelegramApiErrorBody | null = null;
    try {
      parsed = JSON.parse(rawBody) as TelegramApiErrorBody;
    } catch {
      parsed = null;
    }

    const description =
      parsed?.description ?? rawBody.slice(0, 200) ?? "Telegram API error";
    const status = response.status;
    const retryAfterSeconds = parsed?.parameters?.retry_after;

    // 429 requires honouring retry_after; 5xx is transient.
    const retryable = status === 429 || (status >= 500 && status < 600);

    return {
      ok: false,
      httpStatus: status,
      errorMessage: description,
      retryAfterSeconds:
        typeof retryAfterSeconds === "number" ? retryAfterSeconds : undefined,
      retryable,
      deliveryUncertain: false,
    };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "unknown error";
    const aborted =
      cause instanceof Error &&
      (cause.name === "AbortError" || /abort/i.test(message));

    return {
      ok: false,
      httpStatus: null,
      errorMessage: aborted
        ? `Telegram request timed out after ${timeoutMs}ms`
        : `Telegram request failed: ${message}`,
      // Timeouts and socket errors are retried, but the request may have been
      // received: mark the delivery as uncertain.
      retryable: true,
      deliveryUncertain: true,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Send one Telegram notification with bounded retries.
 *
 * Retry policy:
 * - HTTP 429: wait `retry_after` seconds reported by Telegram, then retry.
 * - HTTP 5xx and network/timeout errors: exponential backoff, then retry.
 * - HTTP 400/401/403 (invalid token, blocked bot, bad chat): permanent failure.
 * - At most `MAX_DELIVERY_ATTEMPTS` total attempts.
 */
export async function sendTelegramNotificationWithRetry(input: {
  botToken: string;
  chatId: string | number;
  eventType: NotificationType;
  payload: TelegramMessagePayload;
  options?: TelegramSendOptions;
  maxAttempts?: number;
}): Promise<TelegramDeliveryResult> {
  const options: TelegramSendOptions = input.options ?? {};
  const sleepImpl = options.sleepImpl ?? sleep;
  const baseBackoffMs = options.baseBackoffMs ?? 500;
  // Use the supplied budget if provided; otherwise fall back to the global constant.
  // Callers pass a reduced budget derived from the persisted attempt count so
  // initial delivery and scheduled retries share the same three-request total.
  const attemptBudget = Math.max(0, Math.min(input.maxAttempts ?? MAX_DELIVERY_ATTEMPTS, MAX_DELIVERY_ATTEMPTS));

  const text = buildTelegramNotificationText(input.eventType, input.payload);

  let attempts = 0;
  let lastErrorMessage = "Telegram delivery was not attempted";
  let lastUncertain = false;

  while (attempts < attemptBudget) {
    attempts += 1;

    const outcome = await sendTelegramMessage({
      botToken: input.botToken,
      chatId: input.chatId,
      text,
      options,
    });

    if (outcome.ok) {
      return {
        status: "delivered",
        attempts,
        telegramMessageId: outcome.messageId,
      };
    }

    lastErrorMessage = outcome.errorMessage;
    lastUncertain = outcome.deliveryUncertain;

    // A timeout or aborted socket may already have reached Telegram. Retrying
    // here could deliver the same message twice, so the uncertainty is
    // recorded and no further request is made.
    if (outcome.deliveryUncertain) {
      return {
        status: "failed",
        attempts,
        errorMessage: outcome.errorMessage,
        permanent: false,
        deliveryUncertain: true,
      };
    }

    if (!outcome.retryable) {
      return {
        status: "failed",
        attempts,
        errorMessage: outcome.errorMessage,
        permanent: true,
        deliveryUncertain: outcome.deliveryUncertain,
      };
    }

    if (attempts >= attemptBudget) {
      return {
        status: "failed",
        attempts,
        errorMessage: outcome.errorMessage,
        // Exhausting the supplied budget on a transient error is not a permanent verdict.
        // a later durable retry could still succeed.
        permanent: false,
        deliveryUncertain: outcome.deliveryUncertain,
      };
    }

    const backoffMs =
      outcome.httpStatus === 429 && outcome.retryAfterSeconds !== undefined
        ? outcome.retryAfterSeconds * 1000
        : baseBackoffMs * 2 ** (attempts - 1);

    await sleepImpl(backoffMs);
  }

  return {
    status: "failed",
    attempts,
    errorMessage: lastErrorMessage,
    permanent: false,
    deliveryUncertain: lastUncertain,
  };
}

/**
 * Sends an explicit test message to a linked chat.
 *
 * Kept separate from the notification pipeline on purpose: a test send never
 * creates an in-app notification or a delivery row, and it is never triggered
 * by enabling a preference.
 */
export async function sendTelegramTestMessage(input: {
  botToken: string;
  chatId: string | number;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const fetchImpl = input.fetchImpl ?? globalThis.fetch;

  if (typeof fetchImpl !== "function") {
    return { ok: false, message: "Outbound HTTP is not available in this runtime." };
  }

  const text = [
    "*PayProof test message*",
    "",
    escapeMarkdownV2("Telegram delivery is working for this chat."),
    escapeMarkdownV2("No payment was verified and no receipt was issued."),
  ].join("\n");

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    input.timeoutMs ?? TELEGRAM_REQUEST_TIMEOUT_MS,
  );

  try {
    const response = await fetchImpl(
      `${TELEGRAM_API_BASE}/bot${input.botToken}/sendMessage`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          chat_id: input.chatId,
          text,
          parse_mode: "MarkdownV2",
          disable_web_page_preview: true,
        }),
      },
    );

    if (response.ok) {
      return { ok: true };
    }

    let description = `Telegram rejected the message (HTTP ${response.status}).`;

    try {
      const body = (await response.json()) as { description?: unknown };
      if (typeof body.description === "string" && body.description.length > 0) {
        description = body.description.slice(0, 200);
      }
    } catch {
      // Keep the status-based message.
    }

    return { ok: false, message: description };
  } catch (cause) {
    const message =
      cause instanceof Error && /abort/i.test(cause.message)
        ? "Telegram did not answer in time."
        : "Could not reach Telegram.";
    return { ok: false, message };
  } finally {
    clearTimeout(timer);
  }
}

