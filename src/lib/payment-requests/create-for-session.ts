import type { MerchantSessionState } from "@/lib/auth/session-validation";
import {
  describeRepositoryInitializationFailure,
  type AuthorizedCreationOutcome,
  type PaymentRequestRepository,
} from "./repository";
import type { NewPaymentRequestInput, PaymentRequest } from "./types";

/** Shown for any create attempt without a valid merchant session. */
export const CREATE_UNAUTHENTICATED_MESSAGE =
  "Sign in with your merchant wallet to create a payment request.";

export type CreatePaymentRequestFailureReason =
  | "unauthenticated"
  | "rejected"
  | "unavailable"
  | "authorization";

export type CreatePaymentRequestResult =
  | {
      ok: true;
      request: PaymentRequest;
      authorizationOutcome?: "created" | "already_consumed";
    }
  | {
      ok: false;
      reason: CreatePaymentRequestFailureReason;
      error: string;
      authorizationOutcome?: Exclude<
        AuthorizedCreationOutcome,
        "created" | "already_consumed"
      >;
    };

export type CreatePaymentRequestDependencies = {
  /** Resolves the authenticated merchant from the server-side session. */
  resolveSession: () => Promise<MerchantSessionState>;
  /** Opens the repository; may throw a configuration error. */
  openRepository: () => PaymentRequestRepository;
  /**
   * When present, the request is created only by consuming this active AI
   * draft authorization. The repository performs both steps atomically.
   */
  authorization?: {
    nonce: string;
    fingerprint: string;
  };
};

/**
 * Creates a payment request owned by the authenticated merchant.
 *
 * Ownership comes from the validated session only. `input` is the client's
 * form payload and carries no merchant address, so a caller cannot create a
 * record that belongs to another merchant — not through the action arguments,
 * not through a query string and not through a connected browser wallet.
 */
export async function createPaymentRequestForSession(
  input: NewPaymentRequestInput,
  { resolveSession, openRepository, authorization }: CreatePaymentRequestDependencies,
): Promise<CreatePaymentRequestResult> {
  // Authenticate before touching configuration or the database, and answer
  // every failure with the same message: an unauthenticated caller learns
  // nothing about the session state or the server setup.
  let session: MerchantSessionState;

  try {
    session = await resolveSession();
  } catch {
    return {
      ok: false,
      reason: "unauthenticated",
      error: CREATE_UNAUTHENTICATED_MESSAGE,
    };
  }

  if (!session.authenticated) {
    return {
      ok: false,
      reason: "unauthenticated",
      error: CREATE_UNAUTHENTICATED_MESSAGE,
    };
  }

  const merchantAddress = session.walletAddress.trim();

  if (merchantAddress.length === 0) {
    return {
      ok: false,
      reason: "unauthenticated",
      error: CREATE_UNAUTHENTICATED_MESSAGE,
    };
  }

  let repo: PaymentRequestRepository;

  try {
    repo = openRepository();
  } catch (cause) {
    return {
      ok: false,
      reason: "unavailable",
      error: describeRepositoryInitializationFailure(cause),
    };
  }

  // The session address is passed separately from the client payload, so the
  // insert's `merchant_address` can only ever be the authenticated merchant.
  if (authorization) {
    const persisted = await repo.createFromAuthorization({
      nonce: authorization.nonce,
      fingerprint: authorization.fingerprint,
      merchantAddress,
      amountLamports: input.amountLamports,
      description: input.description,
      customerName: input.customerName,
      customerEmail: input.customerEmail,
    });

    if ("type" in persisted) {
      return {
        ok: false,
        reason: persisted.type === "unauthorized" ? "unauthenticated" : "rejected",
        error: persisted.message,
      };
    }

    if (persisted.outcome === "created" || persisted.outcome === "already_consumed") {
      return {
        ok: true,
        request: persisted.request,
        authorizationOutcome: persisted.outcome,
      };
    }

    return {
      ok: false,
      reason: "authorization",
      error: "The draft authorization is no longer valid.",
      authorizationOutcome: persisted.outcome,
    };
  }

  const persisted = await repo.create(input, merchantAddress);

  if ("type" in persisted) {
    return {
      ok: false,
      reason: persisted.type === "unauthorized" ? "unauthenticated" : "rejected",
      error: persisted.message,
    };
  }

  return { ok: true, request: persisted };
}
