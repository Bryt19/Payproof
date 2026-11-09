import type { ReactNode } from "react";
import Link from "next/link";
import Navbar from "@/components/landing/navbar";
import Footer from "@/components/landing/footer";

export default function LegalPageShell({
  title,
  description,
  updated,
  children,
}: {
  title: string;
  description: string;
  updated: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-black text-white selection:bg-[#9945FF]/40 selection:text-white">
      <Navbar />

      <main className="mx-auto w-full max-w-3xl px-4 pb-16 pt-28 sm:px-6 sm:pt-32 lg:pb-24">
        <div className="mb-8">
          <Link
            href="/"
            className="text-xs font-medium text-white/50 transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#9945FF]"
          >
            ← Back to Payproof
          </Link>
          <p className="eyebrow-label mt-6">Legal</p>
          <h1
            className="mt-2 text-3xl font-bold tracking-tight text-white sm:text-4xl"
            style={{ fontFamily: "'DM Sans', sans-serif" }}
          >
            {title}
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-white/60 sm:text-base">
            {description}
          </p>
          <p className="mt-3 text-xs text-white/40">Last updated: {updated}</p>
        </div>

        <article className="rounded-2xl border border-white/[0.08] bg-[#0E0E12] p-5 shadow-[0_8px_32px_rgba(0,0,0,0.35)] sm:p-8">
          <div className="space-y-8 text-sm leading-relaxed text-white/70 [&_a]:text-[#C14BF0] [&_a]:underline-offset-2 hover:[&_a]:underline [&_h2]:font-['DM_Sans',sans-serif] [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:text-white [&_h3]:mt-4 [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:text-white [&_li]:mt-2 [&_p]:mt-3 [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-5">
            {children}
          </div>
        </article>
      </main>

      <Footer />
    </div>
  );
}
