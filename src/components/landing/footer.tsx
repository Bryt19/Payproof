"use client";

import React, { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PayproofLogo } from "./brand-logo";
import { footer } from "@content/payproof";
import { useWalletAuth } from "@/lib/wallet/use-wallet-auth";
import { WalletConnectModal } from "./wallet-connect-modal";

const PROTECTED_PATHS = new Set([
  "/dashboard",
  "/payments",
  "/invoices",
  "/payment-requests",
  "/ai-assistant",
]);

function isProtectedConsoleHref(href: string): boolean {
  return PROTECTED_PATHS.has(href);
}

function SocialIcon({ id }: { id: string }) {
  if (id === "x") {
    return (
      <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </svg>
    );
  }

  if (id === "discord") {
    return (
      <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M19.27 5.33C17.94 4.71 16.5 4.26 15 4a.09.09 0 0 0-.07.03c-.18.33-.39.76-.53 1.09a16.09 16.09 0 0 0-4.8 0c-.14-.34-.35-.76-.54-1.09-.01-.02-.04-.03-.07-.03-1.5.26-2.93.71-4.27 1.33-.01 0-.02.01-.03.02-2.72 4.07-3.47 8.03-3.1 11.95 0 .02.01.04.03.05 1.8 1.32 3.53 2.12 5.24 2.65.03.01.06 0 .07-.02.4-.55.76-1.13 1.07-1.74.02-.04 0-.08-.04-.09-.57-.22-1.11-.48-1.64-.78-.04-.02-.04-.08-.01-.11.11-.08.22-.17.33-.25.02-.02.05-.02.07-.01 3.44 1.57 7.15 1.57 10.55 0 .02-.01.05-.01.07.01.11.09.22.17.33.26.04.03.04.08-.01.11-.52.31-1.07.56-1.64.78-.04.01-.05.06-.04.09.32.61.68 1.19 1.07 1.74.02.02.05.03.08.02 1.72-.53 3.45-1.33 5.25-2.65.02-.01.03-.03.03-.05.44-4.53-.73-8.46-3.1-11.95-.01-.01-.02-.02-.04-.02z" />
      </svg>
    );
  }

  return (
    <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
    </svg>
  );
}

function LinkChip({
  href,
  label,
}: {
  href: string;
  label: string;
}) {
  const isSoon = label.endsWith("(Soon)");
  const displayLabel = label.replace(/\s*\(Soon\)$/, "");
  return (
    <span>
      {displayLabel}
      {isSoon && (
        <span
          className="ml-1.5 inline-block rounded-full border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[10px] font-medium text-white/40 uppercase tracking-wider"
          aria-label={`${displayLabel} — coming soon`}
        >
          Soon
        </span>
      )}
    </span>
  );
}

export default function Footer() {
  const router = useRouter();
  const { status } = useWalletAuth();
  const [connectOpen, setConnectOpen] = useState(false);
  const pendingHref = useRef<string | null>(null);
  const [productColumn, exploreColumn, legalColumn] = footer.columns;

  const onProtectedClick = useCallback(
    (event: React.MouseEvent<HTMLAnchorElement>, href: string) => {
      if (!isProtectedConsoleHref(href)) return;
      if (status === "connected") return;
      event.preventDefault();
      pendingHref.current = href;
      setConnectOpen(true);
    },
    [status],
  );

  const handleConnected = useCallback(() => {
    setConnectOpen(false);
    const href = pendingHref.current;
    pendingHref.current = null;
    if (href) router.push(href);
  }, [router]);

  const renderProtectedLink = (href: string, label: string, chip?: boolean) => (
    <Link
      href={href}
      onClick={(e) => onProtectedClick(e, href)}
      className="inline-block py-1 text-sm text-white/70 hover:text-white transition-colors"
    >
      {chip ? <LinkChip href={href} label={label} /> : label}
    </Link>
  );

  return (
    <footer className="relative border-t border-white/[0.08] bg-black text-white/70 py-16 lg:py-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-10 lg:gap-12 pb-12 border-b border-white/[0.08] items-start">
          {/* Brand lockup — left, same row as the link columns */}
          <div className="lg:col-span-3 flex flex-col items-start gap-3">
            <Link href="/" aria-label="Payproof Home">
              <PayproofLogo />
            </Link>
            <p className="text-xs font-mono text-white/50 tracking-wider uppercase">
              {footer.tagline}
            </p>
            <p className="text-sm text-white/60 max-w-xs leading-relaxed">
              {footer.description}
            </p>
            {/* Social Icons */}
            <div className="flex items-center gap-3 mt-1">
              {footer.socials.map((social) => (
                <a
                  key={social.id}
                  href={social.href}
                  className="w-11 h-11 rounded-full bg-white/[0.05] border border-white/10 flex items-center justify-center text-white/70 hover:text-white hover:bg-white/10 hover:border-[#9945FF] transition-all"
                  aria-label={social.label}
                >
                  <SocialIcon id={social.id} />
                </a>
              ))}
            </div>
          </div>

          {/* Product column */}
          <div className="lg:col-span-3">
            <h4 className="text-xs font-mono uppercase tracking-[0.2em] text-white/50 mb-5">
              {productColumn.title}
            </h4>
            <ul className="space-y-3">
              {productColumn.links.map((item) => (
                <li key={item.label}>
                  {isProtectedConsoleHref(item.href)
                    ? renderProtectedLink(item.href, item.label, true)
                    : (
                      <Link
                        href={item.href}
                        className="inline-block py-1 text-sm text-white/70 hover:text-white transition-colors"
                      >
                        <LinkChip href={item.href} label={item.label} />
                      </Link>
                    )}
                </li>
              ))}
            </ul>
          </div>

          {/* Explore column */}
          <div className="lg:col-span-3">
            <h4 className="text-xs font-mono uppercase tracking-[0.2em] text-white/50 mb-5">
              {exploreColumn.title}
            </h4>
            <ul className="space-y-3">
              {exploreColumn.links.map((item) => (
                <li key={item.label}>
                  <Link
                    href={item.href}
                    className="inline-block py-1 text-sm text-white/70 hover:text-white transition-colors"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Legal column + Language — same row as other nav links */}
          <div className="lg:col-span-3 flex flex-col">
            <h4 className="text-xs font-mono uppercase tracking-[0.2em] text-white/50 mb-5">
              {legalColumn.title}
            </h4>
            <ul className="space-y-3">
              {legalColumn.links.map((item) => (
                <li key={item.label}>
                  <Link
                    href={item.href}
                    className="inline-block py-1 text-sm text-white/70 hover:text-white transition-colors"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
            {/* Language Selector — below the legal links, same column */}
            <div className="mt-6 pt-4 border-t border-white/[0.06] flex items-center gap-2">
              <svg className="w-4 h-4 text-white/50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
              </svg>
              <span className="text-xs font-medium text-white/60">{footer.language.code}</span>
              <span className="text-xs text-white/30">•</span>
              <span className="text-xs text-white/40">{footer.language.region}</span>
            </div>
          </div>
        </div>

        {/* Bottom bar: copyright + bottom note */}
        <div className="pt-8 flex flex-col sm:flex-row items-center justify-between text-xs text-white/40 gap-4">
          <p>{footer.copyright}</p>
          <p className="text-white/30 font-mono">
            {footer.bottomNote}
          </p>
        </div>
      </div>

      <WalletConnectModal
        open={connectOpen}
        onClose={() => setConnectOpen(false)}
        onConnected={handleConnected}
      />
    </footer>
  );
}
