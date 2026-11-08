"use client";

import { useState, useCallback, useEffect } from "react";
import {
  CopyableValue,
  RadioField,
  SelectField,
  Toggle,
} from "@/components/settings/settings-controls";
import { Button } from "@/components/ui/button";
import {
  CheckIcon,
  ChevronIcon,
  CloseIcon,
  SearchIcon,
  ExternalLinkIcon,
} from "@/components/dashboard/icons";
import { useWalletAuth } from "@/lib/wallet/use-wallet-auth";
import { WalletConnectModal } from "@/components/landing/wallet-connect-modal";
import { shortenAddress } from "@/lib/solana/address";
import { SOLANA_NETWORK_NAME } from "@/lib/solana/config";

const SETTINGS_STORAGE_KEY = "payproof_console_settings";

export type PayproofSettings = {
  // General
  network: string;
  currency: string;
  timezone: string;
  dateFormat: string;
  numberFormat: string;

  // Notifications
  notifications: Record<string, boolean>;

  // Appearance
  theme: string;
  compactMode: boolean;
  reduceMotion: boolean;

  // Security
  autoVerifyOnchain: boolean;
  maskWalletAddress: boolean;
};

const DEFAULT_SETTINGS: PayproofSettings = {
  network: "devnet",
  currency: "sol",
  timezone: "Africa/Lagos",
  dateFormat: "eu",
  numberFormat: "dot",
  notifications: {
    "payment-received": true,
    "payment-request-update": true,
    "invoice-status": true,
    "failed-transaction": true,
    security: true,
  },
  theme: "dark",
  compactMode: false,
  reduceMotion: false,
  autoVerifyOnchain: true,
  maskWalletAddress: false,
};

type SectionId =
  | "general"
  | "wallet"
  | "notifications"
  | "appearance"
  | "security"
  | "about";

const SECTION_TITLES: Record<SectionId, string> = {
  general: "General preferences",
  wallet: "Wallet settings",
  notifications: "Notifications",
  appearance: "Appearance",
  security: "Security & privacy",
  about: "About Payproof",
};

const SECTION_DESCRIPTIONS: Record<SectionId, string> = {
  general: "How Payproof displays currency, time, and numbers for you.",
  wallet: "Manage the Solana wallet connected to this console.",
  notifications: "Choose which transaction and payment events you want to be notified about.",
  appearance: "Theme and visual density preferences.",
  security: "How Payproof handles non-custodial signing and data privacy.",
  about: "Product details, version, and external blockchain resources.",
};

const CURRENCIES = [
  { value: "sol", label: "Solana (SOL)", description: "On-chain settlement asset" },
  { value: "usd", label: "United States Dollar (USD)", description: "Reference display currency" },
  { value: "eur", label: "Euro (EUR)", description: "Reference display currency" },
  { value: "gbp", label: "British Pound (GBP)", description: "Reference display currency" },
  { value: "ngn", label: "Nigerian Naira (NGN)", description: "Reference display currency" },
] as const;

const TIMEZONES = [
  { value: "Africa/Lagos", label: "Lagos (WAT)", description: "UTC+1" },
  { value: "Africa/Accra", label: "Accra (GMT)", description: "UTC+0" },
  { value: "Africa/Nairobi", label: "Nairobi (EAT)", description: "UTC+3" },
  { value: "Africa/Johannesburg", label: "Johannesburg (SAST)", description: "UTC+2" },
  { value: "Europe/London", label: "London (GMT/BST)", description: "UTC+0/+1" },
  { value: "Europe/Berlin", label: "Berlin (CET/CEST)", description: "UTC+1/+2" },
  { value: "America/New_York", label: "New York (EST/EDT)", description: "UTC-5/-4" },
  { value: "America/Chicago", label: "Chicago (CST/CDT)", description: "UTC-6/-5" },
  { value: "America/Los_Angeles", label: "Los Angeles (PST/PDT)", description: "UTC-8/-7" },
  { value: "Asia/Dubai", label: "Dubai (GST)", description: "UTC+4" },
  { value: "Asia/Singapore", label: "Singapore (SGT)", description: "UTC+8" },
] as const;

const DATE_FORMATS = [
  { value: "eu", label: "European (DD/MM/YYYY)", description: "07/11/2026" },
  { value: "us", label: "US (MM/DD/YYYY)", description: "11/07/2026" },
  { value: "iso", label: "ISO 8601", description: "2026-11-07" },
  { value: "full", label: "Full local", description: "7 November 2026" },
] as const;

const NUMBER_FORMATS = [
  { value: "dot", label: "Dot decimal, comma separator", description: "1,234.56" },
  { value: "comma", label: "Comma decimal, dot separator", description: "1.234,56" },
  { value: "space", label: "Space separator", description: "1 234.56" },
] as const;

const NETWORKS = [
  { value: "devnet", label: "Solana Devnet", description: "Live devnet verification environment" },
] as const;

const NOTIFICATION_ITEMS = [
  {
    key: "payment-received",
    label: "Payment received",
    description: "Instant notification when an on-chain payment is verified.",
  },
  {
    key: "payment-request-update",
    label: "Payment request updates",
    description: "Status changes, views, and expiration on your payment requests.",
  },
  {
    key: "invoice-status",
    label: "Invoice status updates",
    description: "Issued client invoices transitioning between draft, sent, and paid.",
  },
  {
    key: "failed-transaction",
    label: "Failed transaction alerts",
    description: "Alerts when an on-chain transaction attempts settlement but fails.",
  },
  {
    key: "security",
    label: "Security notifications",
    description: "Important security and wallet disconnection notifications.",
  },
];

const SECTIONS: readonly SectionId[] = [
  "general",
  "wallet",
  "notifications",
  "appearance",
  "security",
  "about",
];

function SectionHeader({
  id,
  children,
}: {
  id: SectionId;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  const title = SECTION_TITLES[id];
  const description = SECTION_DESCRIPTIONS[id];

  return (
    <div>
      <div className="flex items-start justify-between gap-4 border-b border-white/[0.06] pb-4">
        <div className="min-w-0">
          <h3 className="text-base font-semibold tracking-tight text-white">
            {title}
          </h3>
          <p className="mt-0.5 text-xs text-white/50">{description}</p>
        </div>

        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((next) => !next)}
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-white/[0.1] bg-white/[0.03] text-white/60 transition-colors hover:border-white/20 hover:bg-white/[0.06] hover:text-white focus-visible:outline-2 focus-visible:outline-[#9945FF]"
        >
          <ChevronIcon
            className={`size-3.5 transition-transform ${open ? "" : "-rotate-90"}`}
          />
          <span className="sr-only">
            {open ? "Collapse section" : "Expand section"}
          </span>
        </button>
      </div>

      {open && <div className="pt-5">{children}</div>}
    </div>
  );
}

function ResourceLink({
  label,
  description,
  href,
}: {
  label: string;
  description: string;
  href: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex items-center justify-between gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 transition-all hover:border-white/[0.15] hover:bg-white/[0.04]"
    >
      <div>
        <p className="text-sm font-medium text-white group-hover:text-[#14F195] transition-colors">
          {label}
        </p>
        <p className="text-xs text-white/45">{description}</p>
      </div>
      <span className="shrink-0 inline-flex items-center gap-1 rounded-full border border-white/[0.1] bg-white/[0.04] px-2.5 py-1 text-xs text-white/70 group-hover:text-white group-hover:border-white/25">
        <ExternalLinkIcon className="size-3.5" />
      </span>
    </a>
  );
}

export default function SettingsClient() {
  const [active, setActive] = useState<SectionId>("general");
  const [search, setSearch] = useState("");
  const [settings, setSettings] = useState<PayproofSettings>(DEFAULT_SETTINGS);
  const [isSavedNotice, setIsSavedNotice] = useState(false);
  const [isWalletModalOpen, setIsWalletModalOpen] = useState(false);

  const { status, isConnected, address, walletName, disconnect } = useWalletAuth();

  // Load preferences from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        setSettings((prev) => ({
          ...prev,
          ...parsed,
          notifications: {
            ...prev.notifications,
            ...(parsed.notifications || {}),
          },
        }));
      }
    } catch {
      // localStorage unavailable or malformed
    }
  }, []);

  // Save settings helper
  const saveSettings = useCallback((newSettings: PayproofSettings) => {
    setSettings(newSettings);
    try {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(newSettings));
      setIsSavedNotice(true);
      setTimeout(() => setIsSavedNotice(false), 2500);
    } catch {
      // ignore
    }
  }, []);

  // Update a single setting
  const updateSetting = useCallback(
    <K extends keyof PayproofSettings>(key: K, value: PayproofSettings[K]) => {
      setSettings((prev) => {
        const next = { ...prev, [key]: value };
        saveSettings(next);
        return next;
      });
    },
    [saveSettings]
  );

  // Update a notification toggle
  const updateNotification = useCallback(
    (key: string, value: boolean) => {
      setSettings((prev) => {
        const next = {
          ...prev,
          notifications: {
            ...prev.notifications,
            [key]: value,
          },
        };
        saveSettings(next);
        return next;
      });
    },
    [saveSettings]
  );

  // Reset all to default
  const resetDefaults = useCallback(() => {
    saveSettings(DEFAULT_SETTINGS);
  }, [saveSettings]);

  const query = search.trim().toLowerCase();
  const filtered = query
    ? SECTIONS.filter((section) =>
        SECTION_TITLES[section].toLowerCase().includes(query)
      )
    : SECTIONS;

  const activeSection = filtered.includes(active) ? active : filtered[0];

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1
              className="text-xl font-bold tracking-tight text-white sm:text-2xl"
              style={{ fontFamily: "'DM Sans', sans-serif" }}
            >
              Settings
            </h1>
            {isSavedNotice && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[#14F195]/30 bg-[#14F195]/10 px-2.5 py-0.5 text-xs font-medium text-[#14F195] animate-in fade-in zoom-in-95 duration-150">
                <CheckIcon className="size-3.5" />
                Settings saved
              </span>
            )}
          </div>
          <p className="mt-1 max-w-xl text-sm text-white/50">
            Configure your merchant currency, regional preferences, wallet, and notifications.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={resetDefaults}
            className="rounded-xl border border-white/[0.1] bg-white/[0.03] px-3.5 py-2 text-xs font-medium text-white/60 transition-colors hover:bg-white/[0.08] hover:text-white"
          >
            Reset defaults
          </button>
          <button
            type="button"
            onClick={() => saveSettings(settings)}
            className="btn-brand-gradient inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-semibold text-white shadow-md transition-transform hover:scale-[1.02]"
          >
            <CheckIcon className="size-3.5" />
            <span>Save Preferences</span>
          </button>
        </div>
      </div>

      {/* Main Settings Container */}
      <section
        aria-label="Console settings"
        className="rounded-2xl border border-white/[0.08] shadow-[0_8px_32px_rgba(0,0,0,0.4)]"
        style={{ background: "#0E0E12" }}
      >
        {/* Top Header & Search */}
        <div className="flex flex-col gap-4 border-b border-white/[0.08] p-5 sm:p-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-white">
                Console Preferences
              </h2>
              <span className="rounded-full border border-white/[0.08] bg-white/[0.06] px-2 py-0.5 text-xs text-white/60">
                {SECTIONS.length} sections
              </span>
            </div>
            <p className="mt-1 text-xs text-white/50">
              Preferences are automatically preserved across browser sessions.
            </p>
          </div>

          <div className="relative flex-1 sm:w-60 sm:flex-initial">
            <label htmlFor="settings-search" className="sr-only">
              Search settings
            </label>
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-white/40" />
            <input
              id="settings-search"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search preferences…"
              className="h-10 w-full rounded-xl border border-white/[0.1] bg-white/[0.03] pl-9 pr-8 text-xs text-white placeholder:text-white/35 focus:border-[#9945FF]/60 focus:bg-white/[0.05] focus:outline-none focus:ring-1 focus:ring-[#9945FF]"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                aria-label="Clear search"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/40 transition-colors hover:text-white"
              >
                <CloseIcon className="size-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Section Tabs */}
        <div
          role="tablist"
          aria-label="Settings sections"
          className="flex flex-wrap items-center gap-2 border-b border-white/[0.06] bg-black/20 px-5 py-3 sm:px-6"
        >
          {filtered.map((section) => {
            const isActive = section === activeSection;

            return (
              <button
                key={section}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setActive(section)}
                className={`rounded-xl px-3.5 py-1.5 text-xs font-medium transition-all duration-150 ${
                  isActive
                    ? "bg-[#9945FF] text-white shadow-[0_0_16px_rgba(153,69,255,0.4)]"
                    : "text-white/60 hover:bg-white/[0.05] hover:text-white"
                }`}
              >
                {SECTION_TITLES[section]}
              </button>
            );
          })}

          {filtered.length === 0 && (
            <p className="text-xs text-white/50">
              No sections match “{search.trim()}”.
            </p>
          )}
        </div>

        {/* Section Content Area */}
        <div className="p-5 sm:p-6">
          {activeSection === "general" && (
            <SectionHeader id="general">
              <div className="space-y-6">
                <div>
                  <RadioField
                    label="Default payment network"
                    description="Solana blockchain network used by Payproof."
                    value={settings.network}
                    options={NETWORKS}
                    onChange={(val) => updateSetting("network", val)}
                  />
                </div>

                <div className="grid gap-5 sm:grid-cols-2">
                  <SelectField
                    label="Preferred currency"
                    description="Default display currency"
                    value={settings.currency}
                    options={CURRENCIES}
                    onChange={(val) => updateSetting("currency", val)}
                  />
                  <SelectField
                    label="Timezone"
                    description="Timestamp localization"
                    value={settings.timezone}
                    options={TIMEZONES}
                    onChange={(val) => updateSetting("timezone", val)}
                  />
                </div>

                <div className="grid gap-5 sm:grid-cols-2">
                  <SelectField
                    label="Date format"
                    description="How dates are shown"
                    value={settings.dateFormat}
                    options={DATE_FORMATS}
                    onChange={(val) => updateSetting("dateFormat", val)}
                  />
                  <SelectField
                    label="Number format"
                    description="Decimal & thousands separators"
                    value={settings.numberFormat}
                    options={NUMBER_FORMATS}
                    onChange={(val) => updateSetting("numberFormat", val)}
                  />
                </div>
              </div>
            </SectionHeader>
          )}

          {activeSection === "wallet" && (
            <SectionHeader id="wallet">
              <div className="space-y-5">
                {isConnected && address ? (
                  <>
                    <div className="flex items-center gap-3 rounded-xl border border-[#14F195]/25 bg-[#14F195]/[0.06] px-4 py-3.5">
                      <span className="shrink-0 size-2.5 rounded-full bg-[#14F195] animate-pulse" />
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-white">
                            Connected Wallet
                          </span>
                          <span className="rounded-md border border-white/[0.1] bg-white/[0.05] px-2 py-0.5 text-[10px] text-white/70">
                            {walletName || "Solana Wallet"}
                          </span>
                        </div>
                        <p className="text-xs text-white/60">
                          {SOLANA_NETWORK_NAME} · Ready for payment requests and invoices
                        </p>
                      </div>
                      <span className="ml-auto text-xs font-mono text-[#14F195]">
                        Active
                      </span>
                    </div>

                    <CopyableValue
                      label="Connected Wallet Address"
                      value={address}
                      description="Public key used to receive customer payments."
                    />

                    <div className="pt-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="md"
                        onClick={disconnect}
                        className="border border-red-500/30 text-red-300 hover:bg-red-500/10 hover:text-red-200"
                      >
                        Disconnect Wallet
                      </Button>
                    </div>
                  </>
                ) : (
                  <div className="rounded-xl border border-[#9945FF]/25 bg-[#9945FF]/[0.05] p-6 text-center sm:text-left">
                    <h4 className="text-base font-semibold text-white">
                      No Solana Wallet Connected
                    </h4>
                    <p className="mt-1 text-xs text-white/60 max-w-md">
                      Connect your Phantom or Solana Wallet Standard wallet to manage payment requests and view verified transactions.
                    </p>
                    <Button
                      type="button"
                      variant="primary"
                      size="md"
                      className="mt-4"
                      onClick={() => setIsWalletModalOpen(true)}
                    >
                      Connect Wallet
                    </Button>
                  </div>
                )}

                <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 text-xs text-white/50">
                  <p className="font-medium text-white/70">Non-Custodial Architecture</p>
                  <p className="mt-1">
                    Payproof never stores private keys or asks for recovery phrases. Wallet signatures occur client-side inside your browser extension.
                  </p>
                </div>
              </div>
            </SectionHeader>
          )}

          {activeSection === "notifications" && (
            <SectionHeader id="notifications">
              <div className="space-y-3">
                {NOTIFICATION_ITEMS.map((item) => (
                  <Toggle
                    key={item.key}
                    label={item.label}
                    description={item.description}
                    checked={Boolean(settings.notifications[item.key])}
                    onChange={(checked) => updateNotification(item.key, checked)}
                  />
                ))}
              </div>
            </SectionHeader>
          )}

          {activeSection === "appearance" && (
            <SectionHeader id="appearance">
              <div className="space-y-6">
                <div>
                  <RadioField
                    label="Theme Mode"
                    description="Visual display theme."
                    value={settings.theme}
                    options={[
                      {
                        value: "dark",
                        label: "Dark Obsidian (Default)",
                        description: "Curated dark background with purple and emerald Solana accents",
                      },
                    ]}
                    onChange={(val) => updateSetting("theme", val)}
                  />
                </div>

                <div className="space-y-3 pt-2">
                  <Toggle
                    label="Compact Table View"
                    description="Reduce padding on transaction and invoice data tables."
                    checked={settings.compactMode}
                    onChange={(val) => updateSetting("compactMode", val)}
                  />

                  <Toggle
                    label="Reduce Motion"
                    description="Minimize decorative transitions and background gradient glows."
                    checked={settings.reduceMotion}
                    onChange={(val) => updateSetting("reduceMotion", val)}
                  />
                </div>
              </div>
            </SectionHeader>
          )}

          {activeSection === "security" && (
            <SectionHeader id="security">
              <div className="space-y-5">
                <div className="rounded-xl border border-[#14F195]/20 bg-[#14F195]/[0.05] p-5">
                  <div className="flex items-start gap-3">
                    <CheckIcon className="shrink-0 size-5 text-[#14F195]" />
                    <div>
                      <p className="text-sm font-semibold text-white">
                        Zero-Custody Guarantee
                      </p>
                      <p className="mt-1 text-xs text-white/60">
                        Funds move peer-to-peer directly between customer and merchant on Solana. Payproof only verifies cryptographic transaction signatures on-chain.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="space-y-3 pt-2">
                  <Toggle
                    label="Strict On-Chain Verification"
                    description="Require Solana RPC consensus confirmation before displaying payment proofs."
                    checked={settings.autoVerifyOnchain}
                    onChange={(val) => updateSetting("autoVerifyOnchain", val)}
                  />

                  <Toggle
                    label="Mask Wallet Addresses on Public Links"
                    description="Shorten merchant addresses in shareable checkout preview cards."
                    checked={settings.maskWalletAddress}
                    onChange={(val) => updateSetting("maskWalletAddress", val)}
                  />
                </div>

                <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
                  <p className="text-sm font-medium text-white mb-2" style={{ fontFamily: "'DM Sans', sans-serif" }}>
                    Security Best Practices
                  </p>
                  <ul className="space-y-2 text-xs text-white/60">
                    <li className="flex items-center gap-2">
                      <span className="size-1.5 rounded-full bg-[#9945FF]" />
                      Never share your seed phrase or private keys with anyone.
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="size-1.5 rounded-full bg-[#9945FF]" />
                      Always inspect payment amounts and recipient addresses before approving transactions.
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="size-1.5 rounded-full bg-[#9945FF]" />
                      Payments are verified against Solana Devnet during current testing.
                    </li>
                  </ul>
                </div>
              </div>
            </SectionHeader>
          )}

          {activeSection === "about" && (
            <SectionHeader id="about">
              <div className="space-y-5">
                <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-5">
                  <div className="flex items-center gap-3.5">
                    <div className="flex size-11 items-center justify-center rounded-xl bg-black border border-white/[0.1] shadow-[0_0_16px_rgba(153,69,255,0.35)] overflow-hidden">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src="/payproof-icon.png"
                        alt="Payproof"
                        className="size-full object-cover"
                      />
                    </div>
                    <div>
                      <p className="text-base font-bold text-white" style={{ fontFamily: "'DM Sans', sans-serif" }}>
                        Payproof
                      </p>
                      <p className="text-xs text-white/50">
                        Version 0.1.0 · Solana Devnet
                      </p>
                    </div>
                  </div>
                  <p className="mt-3 text-xs text-white/65 leading-relaxed">
                    Solana-powered payment verification platform for merchants and customers. Turns every payment into an immutable, verifiable proof on the blockchain.
                  </p>
                </div>

                <div className="space-y-2.5">
                  <p className="text-xs font-semibold uppercase tracking-wider text-white/45">
                    Blockchain Resources
                  </p>
                  <ResourceLink
                    label="Solana Documentation"
                    description="Explore Solana core architecture, accounts, and RPC specifications."
                    href="https://docs.solana.com"
                  />
                  <ResourceLink
                    label="Solana Devnet Explorer"
                    description="View live Devnet blocks, transaction signatures, and account states."
                    href="https://explorer.solana.com/?cluster=devnet"
                  />
                  <ResourceLink
                    label="Solana Pay Specification"
                    description="Technical specification for URL transfer requests and merchant references."
                    href="https://solanapay.com"
                  />
                  <ResourceLink
                    label="Phantom Wallet"
                    description="Non-custodial Solana wallet for desktop and mobile."
                    href="https://phantom.app"
                  />
                </div>
              </div>
            </SectionHeader>
          )}
        </div>
      </section>

      {/* Wallet Connect Modal */}
      <WalletConnectModal
        open={isWalletModalOpen}
        onClose={() => setIsWalletModalOpen(false)}
        onConnected={() => setIsWalletModalOpen(false)}
      />
    </div>
  );
}
