import {
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import type { PaymentRequestDraft } from "./payment-draft";

/**
 * Server-signed draft tokens.
 *
 * A draft token is the merchant's proof that the server validated a specific
 * proposed payment request for their authenticated wallet. It is intentionally
 * short-lived and signed, so Stage 2 can accept exactly the reviewed payload
 * without ever storing draft data in Supabase.
 *
 * Format: ppd1.<base64url(payload)>.<base64url(HMAC-SHA256)>
 * The HMAC input includes the version prefix and the encoded payload.
 */

export const DRAFT_TOKEN_PREFIX = "ppd1";
export const DRAFT_TOKEN_TTL_SECONDS = 10 * 60;
export const DRAFT_TOKEN_SECRET_ENV = "AI_DRAFT_TOKEN_SECRET";
export const MIN_DRAFT_TOKEN_SECRET_LENGTH = 32;

/**
 * A signed draft token is well under this size. The cap keeps attacker-supplied
 * strings from reaching the HMAC comparison at an unbounded length.
 */
export const MAX_DRAFT_TOKEN_LENGTH = 4 * 1024;

export type DraftTokenPayload = {
  v: 1;
  /** Merchant wallet from the authenticated session only. */
  wallet: string;
  /** Single-use random identifier, hex encoded. */
  nonce: string;
  /** Issued-at, seconds since epoch. */
  iat: number;
  /** Expiry, seconds since epoch. */
  exp: number;
  draft: PaymentRequestDraft;
};

export type DraftTokenFailureReason =
  | "malformed"
  | "invalid_signature"
  | "invalid_payload"
  | "expired"
  | "wrong_merchant";

export type VerifyDraftTokenResult =
  | { ok: true; payload: DraftTokenPayload }
  | { ok: false; reason: DraftTokenFailureReason };

export type CreateDraftTokenOptions = {
  secret: string;
  now?: Date;
  nonce?: string;
};

export type CreateDraftTokenResult = {
  token: string;
  payload: DraftTokenPayload;
  expiresAt: string;
};

/**
 * Resolves the dedicated draft-signing secret. There is deliberately no
 * fallback to another secret: a missing or weak value fails preparation closed
 * instead of signing tokens with a key that was meant for something else.
 */
export function resolveDraftTokenSecret(): string | null {
  const secret = process.env[DRAFT_TOKEN_SECRET_ENV]?.trim();

  if (!secret || secret.length < MIN_DRAFT_TOKEN_SECRET_LENGTH) {
    return null;
  }

  return secret;
}

function sign(secret: string, encodedPayload: string): string {
  return createHmac("sha256", secret)
    .update(`${DRAFT_TOKEN_PREFIX}.${encodedPayload}`, "utf8")
    .digest("base64url");
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function isDraftPayload(value: unknown): value is DraftTokenPayload {
  if (!value || typeof value !== "object") return false;

  const payload = value as Partial<DraftTokenPayload>;
  const draft = payload.draft as Partial<PaymentRequestDraft> | undefined;

  return (
    payload.v === 1 &&
    typeof payload.wallet === "string" &&
    payload.wallet.trim().length > 0 &&
    typeof payload.nonce === "string" &&
    /^[0-9a-f]{16,64}$/.test(payload.nonce) &&
    typeof payload.iat === "number" &&
    Number.isInteger(payload.iat) &&
    typeof payload.exp === "number" &&
    Number.isInteger(payload.exp) &&
    payload.exp > payload.iat &&
    Boolean(draft) &&
    typeof draft?.amountLamports === "string" &&
    /^\d+$/.test(draft.amountLamports) &&
    typeof draft.amountSol === "string" &&
    typeof draft.description === "string" &&
    (draft.customerName === null || typeof draft.customerName === "string") &&
    (draft.customerEmail === null || typeof draft.customerEmail === "string")
  );
}

/**
 * Signs a validated draft for one merchant wallet.
 */
export function createDraftToken(
  draft: PaymentRequestDraft,
  wallet: string,
  { secret, now = new Date(), nonce }: CreateDraftTokenOptions,
): CreateDraftTokenResult {
  const iat = Math.floor(now.getTime() / 1000);
  const exp = iat + DRAFT_TOKEN_TTL_SECONDS;

  const payload: DraftTokenPayload = {
    v: 1,
    wallet: wallet.trim(),
    nonce: nonce ?? randomBytes(16).toString("hex"),
    iat,
    exp,
    draft,
  };

  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );
  const signature = sign(secret, encodedPayload);

  return {
    token: `${DRAFT_TOKEN_PREFIX}.${encodedPayload}.${signature}`,
    payload,
    expiresAt: new Date(exp * 1000).toISOString(),
  };
}

/**
 * Verifies signature, shape, expiry and — when supplied — merchant ownership.
 * Never throws for attacker-controlled input.
 */
export function verifyDraftToken(
  token: string,
  {
    secret,
    now = new Date(),
    wallet,
  }: {
    secret: string;
    now?: Date;
    wallet?: string;
  },
): VerifyDraftTokenResult {
  if (
    typeof token !== "string" ||
    token.length === 0 ||
    token.length > MAX_DRAFT_TOKEN_LENGTH
  ) {
    return { ok: false, reason: "malformed" };
  }

  const parts = token.split(".");

  if (parts.length !== 3 || parts[0] !== DRAFT_TOKEN_PREFIX) {
    return { ok: false, reason: "malformed" };
  }

  const [, encodedPayload, signature] = parts;

  if (!encodedPayload || !signature) {
    return { ok: false, reason: "malformed" };
  }

  const expectedSignature = sign(secret, encodedPayload);

  if (!safeEqual(signature, expectedSignature)) {
    return { ok: false, reason: "invalid_signature" };
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    );
  } catch {
    return { ok: false, reason: "invalid_payload" };
  }

  if (!isDraftPayload(parsed)) {
    return { ok: false, reason: "invalid_payload" };
  }

  if (typeof wallet === "string" && parsed.wallet !== wallet.trim()) {
    return { ok: false, reason: "wrong_merchant" };
  }

  const nowSeconds = Math.floor(now.getTime() / 1000);

  if (parsed.exp <= nowSeconds) {
    return { ok: false, reason: "expired" };
  }

  return { ok: true, payload: parsed };
}
