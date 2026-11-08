import Link from "next/link";

export default function QuickActions() {
  return (
    <section
      aria-labelledby="quick-actions-heading"
      className="rounded-2xl border border-line p-5"
      style={{ background: "#0E0E12" }}
    >
      <h2
        id="quick-actions-heading"
        className="text-sm font-semibold"
        style={{ fontFamily: "'DM Sans', sans-serif" }}
      >
        Quick actions
      </h2>
      <p className="mt-0.5 text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>
        Start a payment request or an upcoming tool.
      </p>

      <div className="mt-4 space-y-2">
        <Link
          href="/payment-requests"
          className="btn-brand-gradient flex w-full items-center justify-between gap-2 rounded-xl px-4 py-3 text-sm font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          Create payment request
          <span aria-hidden="true" className="text-base leading-none">
            →
          </span>
        </Link>

        <button
          type="button"
          disabled
          aria-describedby="quick-actions-note"
          className="flex w-full items-center justify-between gap-2 rounded-xl border border-line px-4 py-3 text-sm font-medium text-neutral-200 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Generate invoice
          <span
            className="rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-white"
            style={{
              background: "linear-gradient(135deg,#9945FF 0%,#C14BF0 100%)",
              opacity: 0.85,
            }}
          >
            Soon
          </span>
        </button>
      </div>

      <p
        id="quick-actions-note"
        className="mt-3 text-[11px]"
        style={{ color: "rgba(255,255,255,0.35)" }}
      >
        Payment requests open a form on their own page. Invoices are not
        available yet.
      </p>
    </section>
  );
}
