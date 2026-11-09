import Link from "next/link";
import { BrandMark } from "@/components/dashboard/icons";
import { SOLANA_NETWORK_NAME } from "@/lib/solana/config";

export default function PaymentRequestNotFound() {
  return (
    <div className="min-h-screen bg-canvas text-ink">
      <header className="border-b border-line bg-surface/80 px-4 py-4 backdrop-blur-md sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
          <Link
            href="/"
            className="inline-flex items-center gap-2.5 rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            aria-label="Payproof home"
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-white/[0.08] bg-white/[0.03] shadow-sm">
              <BrandMark className="size-5" />
            </span>
            <span className="text-sm font-bold tracking-tight text-white">Payproof</span>
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
