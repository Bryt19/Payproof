import type { PostgrestError } from "@supabase/supabase-js";
import {
  createSupabaseClient,
  mapPaymentRequestRow,
  SUPABASE_TABLE,
  SupabaseConfigurationError,
} from "./supabase";
import { generatePaymentReference, generatePaymentRequestId } from "./ids";
import {
  validatePaymentRequestForm,
  type ValidatedPaymentRequest,
} from "./validation";
import { formatSolExact } from "@/lib/solana/units";
import type { NewPaymentRequestInput, PaymentRequest } from "./types";

export type RepositoryErrorCode =
  | "unavailable"
  | "unauthorized"
  | "conflict"
  | "invalid";

export type RepositoryError = {
  type: RepositoryErrorCode;
  message: string;
};

export type VerifiedPaymentInput = {
  transactionSignature: string;
  payerAddress: string;
  verifiedAt: string;
};

export interface PaymentRequestRepository {
  /** Newest first. Returns an error result when the database is unavailable. */
  list(): Promise<readonly PaymentRequest[] | RepositoryError>;
  /** Returns `null` for an unknown reference, or an error result on failure. */
  getByReference(
    reference: string,
  ): Promise<PaymentRequest | null | RepositoryError>;
  /** Finds the request already paid by a signature, used for duplicate checks. */
  getByTransactionSignature(
    signature: string,
  ): Promise<PaymentRequest | null | RepositoryError>;
  /** Persists a validated request. The caller supplies the (already-validated) merchant address or null. */
  create(
    input: NewPaymentRequestInput,
    merchantAddress: string | null,
  ): Promise<PaymentRequest | RepositoryError>;
  /**
   * Atomically marks a still-pending request as paid.
   *
   * The update only matches a row that is `pending` and has no signature yet, so
   * concurrent or duplicate verifications cannot overwrite an existing result.
   * Returns `unchanged` when no row matched and a conflict when the signature
   * is already attached to another request.
   */
  markVerified(
    reference: string,
    input: VerifiedPaymentInput,
  ): Promise<"updated" | "unchanged" | RepositoryError>;
}

/** A single retry covers the astronomically unlikely reference collision. */
const MAX_CREATE_ATTEMPTS = 2;

/**
 * Logs a database failure with the PostgREST error code and message.
 *
 * `details` is deliberately omitted: Postgres puts offending column values
 * (for example a customer email) into it, and logs must not contain customer
 * data or credentials.
 */
function logRepositoryFailure(operation: string, error: PostgrestError): void {
  console.error(
    `[payment-requests] Supabase ${operation} failed: code=${error.code ?? "unknown"} message=${error.message} hint=${error.hint ?? "none"}`,
  );
}

/**
 * Logs a repository initialization failure and returns a message that is safe
 * to show in the UI. Credentials and secret values are never included.
 */
export function describeRepositoryInitializationFailure(
  cause: unknown,
): string {
  if (cause instanceof SupabaseConfigurationError) {
    console.error(
      `[payment-requests] Cannot reach Supabase: ${cause.message}`,
    );

    return "Payment requests are unavailable because the server is missing its Supabase configuration.";
  }

  console.error(
    "[payment-requests] Could not initialise the Supabase repository:",
    cause instanceof Error ? cause.message : "unknown error",
  );

  return "Payment requests are temporarily unavailable. Please try again.";
}

/**
 * Validates and normalizes a creation input using the same pure validation
 * used on the client, then additionally enforces server-side invariants the
 * client cannot fully trust: integer lamports and a positive amount.
 *
 * The form validator works in SOL, so the incoming lamports string is
 * converted to an exact decimal SOL string first. Passing lamports straight in
 * would multiply the amount by 1e9 and reject most valid requests.
 */
function validateForCreate(
  input: NewPaymentRequestInput,
): ValidatedPaymentRequest | RepositoryError {
  const rawAmount = input.amountLamports.trim();

  if (!/^\d+$/.test(rawAmount)) {
    return {
      type: "invalid",
      message: "Amount must be a whole number of lamports.",
    };
  }

  const lamports = BigInt(rawAmount);

  if (lamports <= 0n) {
    return {
      type: "invalid",
      message: "Amount must be greater than 0 SOL.",
    };
  }

  // Validate everything, including the 10 SOL cap, with the shared validator.
  const result = validatePaymentRequestForm({
    amount: formatSolExact(lamports),
    description: input.description,
    customerName: input.customerName ?? "",
    customerEmail: input.customerEmail ?? "",
  });

  if (!result.ok) {
    const first = Object.keys(result.errors)[0] as keyof typeof result.errors;
    return {
      type: "invalid",
      message:
        result.errors[first] ??
        "The request was invalid and could not be saved.",
    };
  }

  // The round trip must preserve the exact lamport amount. A mismatch would
  // mean the request we persist is not the amount the caller asked for.
  if (BigInt(result.value.amountLamports) !== lamports) {
    return {
      type: "invalid",
      message: "Amount must be a whole number of lamports.",
    };
  }

  return result.value;
}

/** Maps an insert failure to an explicit, UI-safe repository error. */
function toInsertError(error: PostgrestError): RepositoryError {
  // 23505: unique violation (reference or id already exists).
  if (error.code === "23505") {
    return {
      type: "conflict",
      message: "A payment request with that reference already exists. Please try again.",
    };
  }

  // 42501: insufficient privilege / row-level security blocked the write.
  if (error.code === "42501") {
    return {
      type: "unauthorized",
      message:
        "The server is not allowed to save payment requests. Check the Supabase service-role configuration.",
    };
  }

  // 23514 / 23502 / 22P02: check, not-null or invalid-text violations.
  if (
    error.code === "23514" ||
    error.code === "23502" ||
    error.code === "22P02"
  ) {
    return {
      type: "invalid",
      message: "The payment request did not satisfy the database constraints.",
    };
  }

  // 42P01 / PGRST205: the table is missing from the schema cache.
  if (error.code === "42P01" || error.code === "PGRST205") {
    return {
      type: "unavailable",
      message:
        "The payment_requests table is missing. Apply the Supabase schema migration, then try again.",
    };
  }

  return {
    type: "unavailable",
    message: "Could not save the payment request. Please try again.",
  };
}

export function createSupabaseRepository(): PaymentRequestRepository {
  // Throws SupabaseConfigurationError when the server is not configured. The
  // failure is explicit; there is no in-memory fallback.
  const supabase = createSupabaseClient();

  return {
    async list() {
      const { data, error } = await supabase
        .from(SUPABASE_TABLE)
        .select("*")
        .order("created_at", { ascending: false });

      if (error) {
        logRepositoryFailure("select", error);
        return {
          type: "unavailable",
          message: "Could not read payment requests.",
        };
      }

      return (data ?? []).map(mapPaymentRequestRow);
    },

    async getByReference(reference) {
      const { data, error } = await supabase
        .from(SUPABASE_TABLE)
        .select("*")
        .eq("reference", reference)
        .maybeSingle();

      if (error) {
        logRepositoryFailure("select-by-reference", error);
        return {
          type: "unavailable",
          message: "Could not read the payment request.",
        };
      }

      if (!data) return null;
      return mapPaymentRequestRow(data);
    },

    async getByTransactionSignature(signature) {
      const { data, error } = await supabase
        .from(SUPABASE_TABLE)
        .select("*")
        .eq("transaction_signature", signature)
        .maybeSingle();

      if (error) {
        logRepositoryFailure("select-by-signature", error);
        return {
          type: "unavailable",
          message: "Could not check whether this transaction was already used.",
        };
      }

      if (!data) return null;
      return mapPaymentRequestRow(data);
    },

    async create(input, merchantAddress) {
      const validated = validateForCreate(input);
      if ("type" in validated) {
        return validated;
      }

      for (let attempt = 0; attempt < MAX_CREATE_ATTEMPTS; attempt += 1) {
        const id = generatePaymentRequestId();
        const reference = generatePaymentReference();

        // The insert is awaited: a failure is never reported as success.
        const { data, error } = await supabase
          .from(SUPABASE_TABLE)
          .insert({
            id,
            reference,
            amount_lamports: validated.amountLamports,
            description: validated.description,
            customer_name: validated.customerName,
            customer_email: validated.customerEmail,
            merchant_address: merchantAddress,
            status: "pending",
          })
          .select("*")
          .single();

        if (!error) {
          if (!data) {
            console.error(
              "[payment-requests] Supabase insert returned no row. The request may not have been persisted.",
            );
            return {
              type: "unavailable",
              message: "Could not save the payment request. Please try again.",
            };
          }

          return mapPaymentRequestRow(data);
        }

        logRepositoryFailure("insert", error);

        // Retry once with a fresh reference when the collision is on our own
        // 32-byte random value rather than a caller-supplied value.
        if (error.code === "23505" && attempt + 1 < MAX_CREATE_ATTEMPTS) {
          continue;
        }

        return toInsertError(error);
      }

      return {
        type: "unavailable",
        message: "Could not save the payment request. Please try again.",
      };
    },

    async markVerified(reference, input) {
      // Conditional update: status and signature must still be untouched. The
      // database serializes concurrent updates, so only one verification can
      // transition this row to paid.
      const { data, error } = await supabase
        .from(SUPABASE_TABLE)
        .update({
          status: "paid",
          transaction_signature: input.transactionSignature,
          payer_address: input.payerAddress,
          verified_at: input.verifiedAt,
        })
        .eq("reference", reference)
        .eq("status", "pending")
        .is("transaction_signature", null)
        .select("id")
        .maybeSingle();

      if (error) {
        // 23505: the partial unique index rejected a signature already used by
        // a different payment request.
        if (error.code === "23505") {
          return {
            type: "conflict",
            message: "This transaction signature has already been used.",
          };
        }

        logRepositoryFailure("mark-verified", error);
        return {
          type: "unavailable",
          message: "Could not record the payment verification.",
        };
      }

      return data ? "updated" : "unchanged";
    },
  };
}

/**
 * Returns the Supabase-backed repository for the current server runtime.
 *
 * Throws when Supabase is not configured or the client cannot be created.
 * Callers must convert that into an explicit error response — the application
 * has no in-memory or demo persistence path.
 */
export function createPaymentRequestRepository(): PaymentRequestRepository {
  return createSupabaseRepository();
}
