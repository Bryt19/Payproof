import {
  createHash,
  createPublicKey,
  randomBytes,
  verify,
} from "node:crypto";

const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58Decode(str: string): Uint8Array {
  let value = 0n;
  for (const char of str) {
    const index = BASE58_ALPHABET.indexOf(char);
    if (index === -1) {
      throw new Error(`Invalid Base58 character: ${char}`);
    }
    value = value * 58n + BigInt(index);
  }

  const bytes: number[] = [];
  while (value > 0n) {
    bytes.unshift(Number(value & 0xffn));
    value >>= 8n;
  }

  for (const char of str) {
    if (char === "1") {
      bytes.unshift(0);
    } else {
      break;
    }
  }

  return new Uint8Array(bytes);
}

function verifyEd25519Signature(
  walletAddress: string,
  message: string,
  signatureHex: string,
): boolean {
  try {
    const rawPubkey = base58Decode(walletAddress);
    if (rawPubkey.length > 32) return false;
    const pubKey32 = new Uint8Array(32);
    pubKey32.set(rawPubkey, 32 - rawPubkey.length);

    // Ed25519 SPKI DER prefix
    const spkiPrefix = Buffer.from("302a300506032b6570032100", "hex");
    const der = Buffer.concat([spkiPrefix, Buffer.from(pubKey32)]);

    const publicKey = createPublicKey({
      key: der,
      format: "der",
      type: "spki",
    });

    return verify(
      null,
      Buffer.from(message, "utf8"),
      publicKey,
      Buffer.from(signatureHex, "hex"),
    );
  } catch {
    return false;
  }
}

export class MerchantAuthChallengeError extends Error {
  constructor(message = "Could not create authentication challenge.") {
    super(message);
    this.name = "MerchantAuthChallengeError";
  }
}

export class MerchantAuthVerifyError extends Error {
  constructor(message = "Could not verify merchant authentication.") {
    super(message);
    this.name = "MerchantAuthVerifyError";
  }
}

export class MerchantAuthEnvironmentError extends Error {
  constructor(message = "Merchant authentication environment is not configured.") {
    super(message);
    this.name = "MerchantAuthEnvironmentError";
  }
}

export type AuthEnvironment = {
  domain: string;
  supabase: any;
  cookieMaxAgeSeconds: number;
  sessionMaxAgeSeconds: number;
  cookieName: string;
};

export function buildChallengeMessage(domain: string, nonce: string): string {
  return `PayProof\n${domain}\n${nonce}`;
}

export function hashSessionToken(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

export type ChallengeResult = {
  nonce: string;
  expiresAt: Date;
};

export type ConsumeChallengeResult =
  | { ok: true; walletAddress: string; sessionToken: string }
  | { ok: false; kind: string; message: string };

export type ValidateSessionResult =
  | { ok: true; walletAddress: string }
  | { ok: false; kind: "unknown" | "expired" };

export interface MerchantAuthService {
  createChallenge: (
    walletAddress: string,
  ) => Promise<ChallengeResult | MerchantAuthChallengeError>;
  consumeChallenge: (
    nonce: string,
    domain: string,
    walletAddress: string,
    signatureHex: string,
  ) => Promise<ConsumeChallengeResult>;
  validateSession: (token: string) => Promise<ValidateSessionResult>;
  invalidateSession: (token: string) => Promise<void>;
}

export async function createMerchantAuthService(
  env: AuthEnvironment,
): Promise<MerchantAuthService> {
  if (!env || !env.domain || !env.supabase) {
    throw new MerchantAuthEnvironmentError();
  }

  const supabase = env.supabase;

  return {
    async createChallenge(walletAddress: string) {
      try {
        const nonce = randomBytes(16).toString("base64url");
        const issuedAt = new Date().toISOString();
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

        const { data, error } = await supabase
          .from("merchant_auth")
          .insert({
            challenge_nonce: nonce,
            domain: env.domain,
            issued_at: issuedAt,
            expires_at: expiresAt,
            wallet_address: walletAddress,
          })
          .select()
          .single();

        if (error || !data) {
          return new MerchantAuthChallengeError();
        }

        return {
          nonce: data.challenge_nonce ?? nonce,
          expiresAt: new Date(data.expires_at ?? expiresAt),
        };
      } catch {
        return new MerchantAuthChallengeError();
      }
    },

    async consumeChallenge(nonce, domain, walletAddress, signatureHex) {
      try {
        const { data: row, error } = await supabase
          .from("merchant_auth")
          .select()
          .eq("challenge_nonce", nonce)
          .is("deleted_at", null)
          .single();

        if (error || !row) {
          return {
            ok: false,
            kind: "unknown-challenge",
            message: "Challenge not found.",
          };
        }

        if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
          return {
            ok: false,
            kind: "expired",
            message: "Challenge has expired.",
          };
        }

        if (row.session_token) {
          return {
            ok: false,
            kind: "already_used",
            message: "Challenge has already been used.",
          };
        }

        if (row.domain !== domain || row.wallet_address !== walletAddress) {
          return {
            ok: false,
            kind: "invalid-signature",
            message: "Invalid signature.",
          };
        }

        const expectedMessage = buildChallengeMessage(domain, nonce);
        const signatureValid = verifyEd25519Signature(
          walletAddress,
          expectedMessage,
          signatureHex,
        );

        if (!signatureValid) {
          return {
            ok: false,
            kind: "invalid-signature",
            message: "Invalid signature.",
          };
        }

        const sessionToken = randomBytes(32).toString("base64url");
        const hashedSessionToken = hashSessionToken(sessionToken);
        const sessionExpiresAt = new Date(
          Date.now() + env.sessionMaxAgeSeconds * 1000,
        ).toISOString();

        const { error: updateError } = await supabase
          .from("merchant_auth")
          .update({
            session_token: hashedSessionToken,
            session_expires_at: sessionExpiresAt,
          })
          .eq("id", row.id);

        if (updateError) {
          return {
            ok: false,
            kind: "update-error",
            message: "Could not create session.",
          };
        }

        return {
          ok: true,
          walletAddress,
          sessionToken,
        };
      } catch (err: any) {
        return {
          ok: false,
          kind: "error",
          message: err?.message ?? "Authentication failed.",
        };
      }
    },

    async validateSession(token: string) {
      try {
        const hashed = hashSessionToken(token);
        const { data: row, error } = await supabase
          .from("merchant_auth")
          .select()
          .eq("session_token", hashed)
          .is("deleted_at", null)
          .single();

        if (error || !row) {
          return { ok: false, kind: "unknown" };
        }

        if (
          row.session_expires_at &&
          new Date(row.session_expires_at).getTime() < Date.now()
        ) {
          return { ok: false, kind: "expired" };
        }

        return { ok: true, walletAddress: row.wallet_address };
      } catch {
        return { ok: false, kind: "unknown" };
      }
    },

    async invalidateSession(token: string) {
      try {
        const hashed = hashSessionToken(token);
        await supabase
          .from("merchant_auth")
          .update({ deleted_at: new Date().toISOString() })
          .eq("session_token", hashed);
      } catch {
        // Best-effort invalidation
      }
    },
  };
}
