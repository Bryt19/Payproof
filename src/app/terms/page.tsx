import type { Metadata } from "next";
import LegalPageShell from "@/components/legal/legal-page-shell";

export const metadata: Metadata = {
  title: "Terms",
  description:
    "Terms for using Payproof to create and verify Solana payment requests.",
};

export default function TermsPage() {
  return (
    <LegalPageShell
      title="Terms"
      description="These Terms govern your use of Payproof. By using Payproof, you agree to use the service responsibly and understand its non-custodial, verification-focused nature."
      updated="May 8, 2026"
    >
      <section>
        <h2>Use of Payproof</h2>
        <p>
          Payproof provides tools for creating payment requests, sharing checkout
          links, and viewing payment verification based on Solana transaction
          data. You may use Payproof only in compliance with applicable laws and
          these Terms.
        </p>
      </section>

      <section>
        <h2>Accounts and wallets</h2>
        <p>
          You are responsible for the wallet(s), devices, and credentials you use
          with Payproof. Payproof is non-custodial and does not control your
          funds. You must review transaction details before approving any wallet
          action.
        </p>
      </section>

      <section>
        <h2>Payment verification</h2>
        <p>
          Payproof aims to reflect payment status based on independent on-chain
          verification. You should not treat a payment as confirmed unless it has
          been verified through the appropriate on-chain checks. You are
          responsible for confirming payment details that are material to your
          business.
        </p>
      </section>

      <section>
        <h2>Acceptable use</h2>
        <p>You agree not to:</p>
        <ul>
          <li>use Payproof for unlawful, fraudulent, or deceptive activity;</li>
          <li>interfere with the security or operation of the service;</li>
          <li>attempt to access data or systems without authorization;</li>
          <li>misrepresent payment status, transaction proof, or affiliation with Payproof.</li>
        </ul>
      </section>

      <section>
        <h2>Third-party services</h2>
        <p>
          Wallets, Solana networks, RPC providers, explorers, and other
          third-party services may affect Payproof’s functionality. Their
          availability, accuracy, and terms are outside Payproof’s control.
        </p>
      </section>

      <section>
        <h2>Disclaimers and limitation of liability</h2>
        <p>
          Payproof is provided “as is” and “as available” without warranties to
          the extent permitted by law. To the maximum extent permitted by law,
          Payproof and its operators will not be liable for indirect, incidental,
          special, consequential, or punitive damages, or for loss of funds,
          profits, data, goodwill, or business opportunities arising from your use
          of the service.
        </p>
      </section>

      <section>
        <h2>Changes to the service or terms</h2>
        <p>
          We may modify Payproof or these Terms as the product evolves. Continued
          use of Payproof after changes become effective constitutes acceptance of
          the updated Terms.
        </p>
      </section>

      <section>
        <h2>Contact</h2>
        <p>
          If you need to report an issue or request information about these Terms,
          use the official Payproof contact or support channel made available by
          the project.
        </p>
      </section>
    </LegalPageShell>
  );
}
