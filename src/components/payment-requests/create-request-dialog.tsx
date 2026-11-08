"use client";

import { useState } from "react";
import type { PaymentRequest } from "@/lib/payment-requests/types";
import CreatePaymentRequestForm from "./create-payment-request-form";
import PaymentRequestPreview from "./payment-request-preview";
import ModalShell from "./modal-shell";

export default function CreateRequestDialog({
  onClose,
  onCreated,
  onPersistenceNotice,
}: {
  onClose: () => void;
  onCreated: (request: PaymentRequest) => void;
  onPersistenceNotice: (notice: string | null) => void;
}) {
  const [step, setStep] = useState<"form" | "confirmation">("form");
  const [savedRequest, setSavedRequest] = useState<PaymentRequest | null>(null);

  function goToConfirmation(request: PaymentRequest) {
    setSavedRequest(request);
    setStep("confirmation");
    onPersistenceNotice(null);
  }

  return (
    <ModalShell
      title={step === "confirmation" ? "Payment request created" : "New payment request"}
      description={
        step === "confirmation"
          ? "This request stays pending until a matching Solana Devnet payment is verified on-chain. Creating it does not move any funds."
          : "Amounts are charged on Solana Devnet. Not connected to a wallet and logged in to PayProof? The request is saved without a merchant address."
      }
      onClose={() => {
        if (step === "confirmation") onClose();
      }}
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
