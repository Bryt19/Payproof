import { isSignature } from "@solana/kit";
import {
  verifyOnChainPayment,
  type OnChainLookup,
} from "../solana/payment-verification";
import { createPaymentReceivedNotification } from "../notifications/server";
import type { RepositoryError } from "./repository";
import { isValidPaymentReference } from "./reference";
import type { PaymentRequest, PaymentRequestStatus } from "./types";

/**
 * Server-only payment verification orchestration.
 *
 * The browser supplies only a reference and a signature. The service reloads
 * the request from Supabase, retrieves and checks the transaction from Devnet,
 * and only then performs a conditional database update. It never trusts an
 * amount, recipient, status or success claim from the client.
 */

export type VerificationRepository = {
  getByReference(
    reference: string,
  ): Promise<PaymentRequest | null | RepositoryError>;
  getByTransactionSignature(
    signature: string,
  ): Promise<PaymentRequest | null | RepositoryError>;
  markVerified(
    reference: string,
    input: {
      transactionSignature: string;
      payerAddress: string;
      verifiedAt: string;
    },
  ): Promise<"updated" | "unchanged" | RepositoryError>;
};

export type PaymentVerificationResult = {
  status: "pending" | "verified" | "rejected" | "error";
  message: string;
  reference: string;
  signature: string;
  /** True when retrying the same request could reasonably succeed. */
  retryable: boolean;
  /** The status stored in Supabase when it is known to the service. */
  requestStatus?: PaymentRequestStatus;
  payerAddress?: string;
  /** Commitment actually observed; verification never requires finality. */
  commitment?: "confirmed" | "finalized";
  /** Stable machine-readable reason for rejections and transient failures. */
  reason?: string;
};

export type PaymentVerificationService = {
  verify(input: {
    reference: string;
    signature: string;
  }): Promise<PaymentVerificationResult>;
};

function rejected(
  reference: string,
  signature: string,
  reason: string,
  message: string,
): PaymentVerificationResult {
  return {
    status: "rejected",
    message,
    reason,
    reference,
    signature,
    retryable: false,
  };
}

function transientError(
  reference: string,
  signature: string,
  reason: string,
  message: string,
): PaymentVerificationResult {
  return {
    status: "error",
    message,
    reason,
    reference,
    signature,
    retryable: true,
  };
}

function alreadyVerified(
  request: PaymentRequest,
  signature: string,
): PaymentVerificationResult {
  return {
    status: "verified",
    message:
      "This payment was already verified on Solana Devnet for this request.",
    reference: request.reference,
    signature,
    retryable: false,
    requestStatus: "paid",
    payerAddress: request.payerAddress ?? undefined,
  };
}

async function notifyPaymentReceived(request: PaymentRequest, signature: string): Promise<void> {
  const merchantAddress = request.merchantAddress?.trim();
  if (!merchantAddress) return;

  await createPaymentReceivedNotification({
    merchantAddress,
    paymentRequestId: request.id,
    paymentRequestReference: request.reference,
    amountLamports: request.amountLamports,
    transactionSignature: signature,
  });
}

function isRepositoryError(value: unknown): value is RepositoryError {
  return Boolean(
    value &&
      typeof value === "object" &&
      "type" in value &&
      typeof (value as RepositoryError).message === "string",
  );
}

export function createPaymentVerificationService({
  repo,
  lookup,
  now = () => new Date().toISOString(),
}: {
  repo: VerificationRepository;
  lookup: OnChainLookup;
  now?: () => string;
}): PaymentVerificationService {
  return {
    async verify({ reference, signature }) {
      if (!isValidPaymentReference(reference)) {
        return rejected(
          reference,
          signature,
          "invalid-reference",
          "This payment reference is not valid.",
        );
      }

      if (!isSignature(signature)) {
        return rejected(
          reference,
          signature,
          "invalid-signature",
          "This is not a valid Solana transaction signature.",
        );
      }

      const loaded = await repo.getByReference(reference);

      if (isRepositoryError(loaded)) {
        return transientError(
          reference,
          signature,
          "repository-unavailable",
          loaded.message,
        );
      }

      if (loaded === null) {
        return rejected(
          reference,
          signature,
          "request-not-found",
          "No payment request matches this reference.",
        );
      }

      const request = loaded;

      if (request.status === "paid") {
        if (request.transactionSignature === signature) {
          return alreadyVerified(request, signature);
        }

        return rejected(
          request.reference,
          signature,
          "request-already-paid",
          "This request has already been paid with a different transaction.",
        );
      }

      if (request.status !== "pending") {
        return rejected(
          request.reference,
          signature,
          "request-not-payable",
          `This payment request is ${request.status} and can no longer be paid.`,
        );
      }

      if (!request.merchantAddress) {
        return rejected(
          request.reference,
          signature,
          "missing-merchant-address",
          "This payment request has no merchant wallet, so it cannot be verified.",
        );
      }

      // Early duplicate check gives a clear answer when the signature is
      // already attached to another request. The unique index added by the
      // migration is the race-safe backstop.
      const existingUse = await repo.getByTransactionSignature(signature);

      if (isRepositoryError(existingUse)) {
        return transientError(
          request.reference,
          signature,
          "repository-unavailable",
          existingUse.message,
        );
      }

      if (existingUse && existingUse.reference !== request.reference) {
        return rejected(
          request.reference,
          signature,
          "signature-already-used",
          "This transaction has already been used to pay another request.",
        );
      }

      let onChain;

      try {
        onChain = await verifyOnChainPayment({
          expected: {
            reference: request.reference,
            merchantAddress: request.merchantAddress,
            amountLamports: request.amountLamports,
          },
          signature,
          lookup,
        });
      } catch (cause) {
        // Only a message is logged: no request details, no credentials.
        console.error(
          "[payment-verification] Devnet verification failed:",
          cause instanceof Error ? cause.message : "unknown error",
        );

        return transientError(
          request.reference,
          signature,
          "rpc-unavailable",
          "Could not reach Solana Devnet to verify this payment. Please retry.",
        );
      }

      if (onChain.status === "pending") {
        return {
          status: "pending",
          message: onChain.message,
          reference: request.reference,
          signature,
          retryable: true,
          requestStatus: "pending",
        };
      }

      if (onChain.status === "rejected") {
        return rejected(
          request.reference,
          signature,
          onChain.reason,
          onChain.message,
        );
      }

      if (onChain.status === "error") {
        return transientError(
          request.reference,
          signature,
          "verification-incomplete",
          onChain.message,
        );
      }

      // All on-chain checks passed. The conditional update is the only write
      // in this flow, and it fails closed on anything but a pending row.
      const update = await repo.markVerified(request.reference, {
        transactionSignature: signature,
        payerAddress: onChain.payerAddress,
        verifiedAt: now(),
      });

      if (update === "updated") {
        // Real application event: payment verified on-chain and persisted.
        // DB unique constraint prevents duplicates on retries/races.
        await notifyPaymentReceived(
          { ...request, transactionSignature: signature, payerAddress: onChain.payerAddress, status: "paid" },
          signature,
        );
        return {
          status: "verified",
          message:
            "Payment verified on Solana Devnet at confirmed commitment.",
          reference: request.reference,
          signature,
          retryable: false,
          requestStatus: "paid",
          payerAddress: onChain.payerAddress,
          commitment: onChain.commitment,
        };
      }

      if (isRepositoryError(update)) {
        if (update.type === "conflict") {
          return rejected(
            request.reference,
            signature,
            "signature-already-used",
            "This transaction has already been used to pay another request.",
          );
        }

        return transientError(
          request.reference,
          signature,
          "repository-write-failed",
          update.message,
        );
      }

      // The row changed between our read and our conditional update. Reload it
      // and resolve idempotently instead of pretending the update happened.
      const current = await repo.getByReference(request.reference);

      if (isRepositoryError(current)) {
        return transientError(
          request.reference,
          signature,
          "repository-unavailable",
          current.message,
        );
      }

      if (current === null) {
        return transientError(
          request.reference,
          signature,
          "request-not-found",
          "The payment request disappeared while it was being verified.",
        );
      }

      if (
        current.status === "paid" &&
        current.transactionSignature === signature
      ) {
        // Idempotent verification path: ensure notification exists (deduped by DB).
        await notifyPaymentReceived(current, signature);
        return alreadyVerified(current, signature);
      }

      if (current.status === "paid") {
        return rejected(
          request.reference,
          signature,
          "request-already-paid",
          "This request has already been paid with a different transaction.",
        );
      }

      const usedElsewhere = await repo.getByTransactionSignature(signature);

      if (isRepositoryError(usedElsewhere)) {
        return transientError(
          request.reference,
          signature,
          "repository-unavailable",
          usedElsewhere.message,
        );
      }

      if (usedElsewhere && usedElsewhere.reference !== request.reference) {
        return rejected(
          request.reference,
          signature,
          "signature-already-used",
          "This transaction has already been used to pay another request.",
        );
      }

      return transientError(
        request.reference,
        signature,
        "verification-conflict",
        "Another verification attempt changed this request. Please retry to confirm the result.",
      );
    },
  };
}
