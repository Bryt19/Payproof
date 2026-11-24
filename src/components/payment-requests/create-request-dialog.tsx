"use client";

import { useState } from "react";
import type { PaymentRequest } from "@/lib/payment-requests/types";
import CreatePaymentRequestForm from "./create-payment-request-form";
import PaymentRequestPreview from "./payment-request-preview";
import ModalShell from "./modal-shell";

export default function CreateRequestDialog({
  onClose,
  onCreated,
  onSaved,
  onPersistenceNotice,
}: {
  onClose: () => void;
  onCreated: (request: PaymentRequest) => void;
  /**
   * Optional: called once the request is saved. Callers that want the dialog
   * dismissed on creation (instead of showing the preview step) can use this.
   */
  onSaved?: (request: PaymentRequest) => void;
  onPersistenceNotice: (notice: string | null) => void;
}) {
  const [step, setStep] = useState<"form" | "confirmation">("form");
  const [savedRequest, setSavedRequest] = useState<PaymentRequest | null>(null);

  function goToConfirmation(request: PaymentRequest) {
    setSavedRequest(request);
    setStep("confirmation");
    onPersistenceNotice(null);
    onSaved?.(request);
  }

  return (
    <ModalShell
      title={step === "confirmation" ? "Payment request created" : "New payment request"}
      description={
        step === "confirmation"
          ? "This request stays pending until a matching Solana Devnet payment is verified on-chain. Creating it does not move any funds."
          : "Amounts are charged on Solana Devnet. Not connected to a wallet and logged in to PayProof? The request is saved without a merchant address."
      }
      onClose={onClose}
      widthClassName="max-w-md sm:max-w-2xl"
    >
      {step === "confirmation" && savedRequest ? (
        <PaymentRequestPreview
          request={savedRequest}
          onCreateAnother={() => {
            setStep("form");
            setSavedRequest(null);
          }}
          onBack={onClose}
        />
      ) : (
        <CreatePaymentRequestForm
          onCreated={goToConfirmation}
          onCancel={onClose}
          onPersistenceNotice={onPersistenceNotice}
        />
      )}
    </ModalShell>
  );
}
