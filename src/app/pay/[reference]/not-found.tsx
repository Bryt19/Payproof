import Link from "next/link";
import { SOLANA_NETWORK_NAME } from "@/lib/solana/config";

export default function PaymentRequestNotFound() {
  return (
    <div className="min-h-screen bg-canvas text-ink">
      <header className="border-b border-line bg-surface/80 px-4 py-4 sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 text-sm font-semibold tracking-tight hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-accent text-accent-ink">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="size-4"
                aria-hidden="true"
              >
                <path d="M12 3.5 18.5 6v5.2c0 4-2.7 7.7-6.5 8.8-3.8-1.1-6.5-4.8-6.5-8.8V6L12 3.5Z" />
                <path d="m9.2 11.8 1.9 1.9 3.7-3.7" />
              </svg>
            </span>
            PayProof
          </Link>

          <div className="flex items-center gap-2 text-xs text-muted">
            <span className="size-1.5 rounded-full bg-accent" />
            {SOLANA_NETWORK_NAME}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6 lg:px-8">
        <section aria-labelledby="checkout-not-found-heading" className="space-y-4">
          <h1
            id="checkout-not-found-heading"
            className="text-2xl font-semibold tracking-tight sm:text-3xl"
          >
            Payment request not found
          </h1>
          <p className="text-sm text-muted">
            No payment request exists for this link. It may have been typed
            incorrectly, or the merchant may have shared a different link.
          </p>

          <div className="rounded-xl border border-line bg-surface p-5">
            <p className="text-xs text-muted">
              Ask the merchant to resend the checkout link. A valid link uses the
              full reference from the original payment request.
            </p>
            <div className="mt-4">
              <Link
                href="/dashboard"
                className="inline-flex rounded-lg border border-line px-3 py-2 text-sm font-medium text-neutral-300 hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                Back to dashboard
              </Link>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
