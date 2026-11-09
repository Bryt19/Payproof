import type { Metadata } from "next";
import LegalPageShell from "@/components/legal/legal-page-shell";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "How Payproof handles wallet, payment, and usage information when you use the product.",
};

export default function PrivacyPage() {
  return (
    <LegalPageShell
      title="Privacy Policy"
      description="This Privacy Policy explains what information Payproof may process when you create, share, or verify payment requests and use the merchant console."
      updated="May 8, 2026"
    >
      <section>
        <h2>Information you provide or generate</h2>
        <p>
          Depending on how you use Payproof, we may process information such as:
        </p>
        <ul>
          <li>public wallet addresses you connect or use to receive payments;</li>
          <li>payment request details, such as amount, description/reference, status, and timestamps;</li>
          <li>customer details you choose to enter, such as a name or email, if those fields are used;</li>
          <li>transaction identifiers and public on-chain data needed to verify payments;</li>
          <li>preferences you save in the console, which may be stored locally in your browser.</li>
        </ul>
      </section>

      <section>
        <h2>On-chain data</h2>
        <p>
          Solana blockchain data is public by design. Wallet addresses,
          transaction signatures, amounts, references, and related transfer
          details may be publicly visible on-chain and through explorers or RPC
          providers. Payproof may read this public data to display and verify
          payment status.
        </p>
      </section>

      <section>
        <h2>How information is used</h2>
        <p>We may use information to:</p>
        <ul>
          <li>provide payment request, invoice, checkout, and verification features;</li>
          <li>display transaction and account status in the merchant console;</li>
          <li>maintain product security, reliability, and abuse prevention;</li>
          <li>improve the product and diagnose technical issues.</li>
        </ul>
      </section>

      <section>
        <h2>Wallet keys and custody</h2>
        <p>
          Payproof does not request your seed phrase or private keys. Wallet
          connections and transaction approvals are intended to be handled by your
          wallet application. You should never enter recovery phrases into
          Payproof.
        </p>
      </section>

      <section>
        <h2>Storage and service providers</h2>
        <p>
          Payproof may use hosting, database, analytics, and infrastructure
          providers to operate the service. Some console preferences may be stored
          in your browser’s local storage. Payment and application records may be
          stored in Payproof’s backend systems, depending on the feature and
          environment.
        </p>
      </section>

      <section>
        <h2>Sharing</h2>
        <p>
          We do not sell personal information. Information may be shared with
          service providers that help operate Payproof, when required by law, or
          when necessary to protect the rights, safety, and security of users or
          the service. Public blockchain data may be visible to anyone.
        </p>
      </section>

      <section>
        <h2>Your choices</h2>
        <p>
          You can disconnect your wallet from the console, clear browser-stored
          preferences, and choose what optional customer information you enter.
          Because blockchain records are public and generally immutable, Payproof
          may not be able to alter or delete on-chain transaction data.
        </p>
      </section>

      <section>
        <h2>Changes</h2>
        <p>
          We may update this Privacy Policy as Payproof changes. The “Last
          updated” date reflects the latest revision shown on this page.
        </p>
      </section>
    </LegalPageShell>
  );
}
