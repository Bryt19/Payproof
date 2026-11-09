import type { Metadata } from "next";
import LegalPageShell from "@/components/legal/legal-page-shell";

export const metadata: Metadata = {
  title: "Disclaimer",
  description:
    "Important information about Payproof, Solana Devnet usage, on-chain verification, and user responsibility.",
};

export default function DisclaimerPage() {
  return (
    <LegalPageShell
      title="Disclaimer"
      description="Payproof provides tools for creating payment requests and viewing on-chain payment verification. This page explains important limitations and responsibilities."
      updated="May 8, 2026"
    >
      <section>
        <h2>General information</h2>
        <p>
          Payproof is provided for informational and transactional workflow
          purposes. Nothing on Payproof constitutes financial, investment, legal,
          tax, or accounting advice. You are responsible for evaluating whether
          Payproof is appropriate for your use case.
        </p>
      </section>

      <section>
        <h2>Development and Devnet environment</h2>
        <p>
          Payproof may operate against <strong className="text-white/90">Solana Devnet</strong>{" "}
          during development and testing. Devnet assets are not real money, and
          Devnet network behavior may differ from Solana Mainnet. Features,
          availability, balances, transaction timing, and verification results can
          change as the product evolves.
        </p>
      </section>

      <section>
        <h2>On-chain verification</h2>
        <p>
          Payproof is designed to treat independent on-chain verification as the
          source of truth for payment status. A payment should only be considered
          confirmed when it has been verified against the relevant Solana
          transaction data for the intended recipient, amount, and reference.
        </p>
        <p>
          Network congestion, RPC availability, wallet behavior, incorrect
          payment details, or integration issues can affect whether a payment can
          be created, submitted, detected, or verified. You should independently
          review important transactions in a Solana explorer or your own records
          when needed.
        </p>
      </section>

      <section>
        <h2>Non-custodial responsibility</h2>
        <p>
          Payproof is intended to be non-custodial. Payproof does not ask for
          your seed phrase or private keys, and wallet signing should happen in
          your wallet application. You are solely responsible for:
        </p>
        <ul>
          <li>protecting your wallet, devices, and recovery credentials;</li>
          <li>reviewing recipient addresses, amounts, and transaction details before signing;</li>
          <li>any transactions you authorize from your wallet;</li>
          <li>complying with applicable laws and regulations in your jurisdiction.</li>
        </ul>
      </section>

      <section>
        <h2>No warranty</h2>
        <p>
          Payproof is provided on an “as is” and “as available” basis, without
          warranties of any kind to the extent permitted by law. We do not
          guarantee uninterrupted availability, error-free operation, or that
          displayed information will always be complete, current, or accurate.
        </p>
      </section>

      <section>
        <h2>Third-party services</h2>
        <p>
          Payproof may interact with third-party wallets, Solana RPC providers,
          explorers, hosting services, databases, and other infrastructure. Those
          services are outside Payproof’s control and may have their own terms,
          privacy practices, outages, or limitations.
        </p>
      </section>
    </LegalPageShell>
  );
}
