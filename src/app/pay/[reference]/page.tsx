import { notFound } from "next/navigation";
import type { Metadata } from "next";
import CheckoutShell from "@/components/checkout/checkout-shell";
import {
  createPaymentRequestRepository,
  describeRepositoryInitializationFailure,
} from "@/lib/payment-requests/repository";
import { isValidPaymentReference } from "@/lib/payment-requests/reference";

export const metadata: Metadata = {
  title: "Pay a payment request",
  description: "Review and pay a Solana payment request on PayProof.",
};

const INVALID_REFERENCE_MESSAGE =
  "This checkout link is not valid. Ask the merchant to share the link again.";

export default async function PayPage({
  params,
}: {
  params: Promise<{ reference: string }>;
}) {
  const { reference } = await params;
  const trimmed = typeof reference === "string" ? reference.trim() : "";

  // A malformed reference is a bad link, not a missing request: it can never
  // match a stored payment request, so there is no reason to query the database.
  if (trimmed.length === 0 || !isValidPaymentReference(trimmed)) {
    return (
      <CheckoutShell
        request={null}
        isLoading={false}
        error={INVALID_REFERENCE_MESSAGE}
      />
    );
  }

  let repo;

  try {
    repo = createPaymentRequestRepository();
  } catch (cause) {
    return (
      <CheckoutShell
        request={null}
        isLoading={false}
        error={describeRepositoryInitializationFailure(cause)}
      />
    );
  }

  // The only value taken from the URL is the reference used for this lookup.
  // Amount, merchant address, description and status all come from the row.
  const result = await repo.getByReference(trimmed);

  if (result === null) {
    notFound();
  }

  if ("type" in result) {
    return (
      <CheckoutShell request={null} isLoading={false} error={result.message} />
    );
  }

  return <CheckoutShell request={result} isLoading={false} error={null} />;
}
