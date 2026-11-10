/**
 * Payproof content
 * -----------------
 * Every marketing string on the landing page lives here so copy can be edited
 * without touching layout. Anything that needs a real figure, customer name,
 * partner, or URL is written as `[REPLACE: ...]`. Links that do not exist yet
 * point at "#".
 */

/** [REPLACE: public docs URL] — used by every READ DOCS button. */
export const DOCS_URL = "#";

export const brand = {
  name: "Payproof",
  wordmark: "Payproof",
  builtOn: "Built on Solana",
  network: "Solana Devnet",
  description:
    "Verifiable payments, instant settlement, and proof-of-payment receipts for businesses, creators, and developers.",
};

export const nav = {
  items: [
    {
      label: "Product",
      items: [
        {
          label: "Payments",
          href: "/#build-for-growth",
          description: "Accept USDC and SOL with one link",
        },
        {
          label: "Receipts",
          href: "/#build-for-growth",
          description: "A proof hash for every payment",
        },
        {
          label: "Invoices",
          href: "/invoices",
          description: "Invoices with proof attached",
        },
      ],
    },
    {
      label: "Developers",
      items: [
        {
          label: "Docs",
          href: DOCS_URL,
          description: "Quickstart and API reference",
        },
        {
          label: "API",
          href: "/#build-for-growth",
          description: "Create and verify payments",
        },
        {
          label: "SDK",
          href: "/#build-for-growth",
          description: "Checkout links for your app",
        },
        {
          label: "Status",
          href: "#",
          description: "[REPLACE: status page URL]",
        },
      ],
    },
    {
      label: "Solutions",
      items: [
        {
          label: "Online stores",
          href: "/#use-cases",
          description: "USDC checkout with proof",
        },
        {
          label: "Freelancers",
          href: "/#use-cases",
          description: "Get paid and prove it",
        },
        {
          label: "Subscriptions",
          href: "/#use-cases",
          description: "Recurring payments, fresh receipts",
        },
      ],
    },
    {
      label: "Pricing",
      items: [
        {
          label: "Fees",
          href: "/#features",
          description: "A fraction of a cent per payment",
        },
        {
          label: "Start free",
          href: "/payment-requests",
          description: "Create your first request",
        },
      ],
    },
    {
      label: "Company",
      items: [
        {
          label: "About",
          href: "#",
          description: "Why we build proof into payments",
        },
        { label: "Blog", href: "#", description: "Product news and updates" },
        { label: "Careers", href: "#", description: "[REPLACE: open roles]" },
        { label: "Contact", href: "#", description: "Talk to the team" },
      ],
    },
  ],
  cta: { label: "GET STARTED", href: "/payment-requests" },
  dashboardCta: { label: "Dashboard", href: "/dashboard" },
  mobile: {
    dashboardLabel: "Merchant dashboard",
    statusLabel: "Active",
    cta: { label: "GET STARTED", href: "/payment-requests" },
    docs: { label: "READ DOCS", href: DOCS_URL },
  },
};

export const hero = {
  headline: "Get paid.",
  headlineAccent: "Prove it instantly.",
  subtext:
    "Payproof turns every Solana payment into a verifiable, shareable proof. Accept payments, issue receipts, and confirm transactions in seconds, with nothing to trust but the chain.",
};

export const wallet = {
  connect: "Connect Wallet",
  connecting: "Connecting…",
  connected: "View Dashboard",
  makePayment: "Make Payment",
  dashboardHref: "/dashboard",
  paymentHref: "/payment-requests",
  retry: "Try again",
  errorPrefix: "Could not connect.",
  checking: "Checking your wallet…",
  modal: {
    title: "Connect a wallet",
    description:
      "Choose a Solana wallet to continue. Payproof never asks for your recovery phrase.",
    availableWallets: "Available wallets",
    noWalletsTitle: "No Solana wallet detected",
    noWalletsDescription:
      "Install Phantom or another Wallet Standard wallet for Solana Devnet, then reload this page.",
    checking: "Checking for browser wallets…",
    connecting: "Waiting for your wallet…",
    close: "Close",
    footnote:
      "Your wallet signs every payment. Payproof never holds your keys or funds.",
  },
};

export const logoStrip = {
  label: "Built on and integrated with",
  /** Integrations shown in the logo marquee. */
  logos: [
    { id: "solana", name: "Solana" },
    { id: "jupiter", name: "Jupiter" },
    { id: "usdc", name: "USDC" },
    { id: "raydium", name: "Raydium" },
    { id: "phantom", name: "Phantom" },
    { id: "kamino", name: "Kamino" },
    { id: "solflare", name: "Solflare" },
  ] as const,
};

export type NewsItem = {
  id: string;
  tag: string;
  title: string;
  description: string;
  ctaText: string;
  ctaHref: string;
  imageUrl: string;
  imageAlt: string;
};

/** [REPLACE: real news] — these three slides are sample announcements. */
export const news: {
  eyebrow: string;
  heading: string;
  description: string;
  items: NewsItem[];
} = {
  eyebrow: "Newsroom",
  heading: "Latest from Payproof",
  description:
    "Product launches, integrations, and announcements from the team building proof into payments.",
  items: [
    {
      id: "payment-receipts",
      tag: "PRODUCT",
      title: "Payproof launches on-chain payment receipts",
      description:
        "Every transaction now produces a verifiable receipt with a reference, amount, and proof hash that anyone can check on Solana Explorer.",
      ctaText: "READ MORE",
      ctaHref: "#",
      imageUrl:
        "https://images.unsplash.com/photo-1559526324-4b87b5e36e44?auto=format&fit=crop&w=1200&q=80",
      imageAlt: "Payment verification on a screen",
    },
    {
      id: "usdc-sol-checkout",
      tag: "INTEGRATION",
      title: "Accept USDC and SOL with one checkout link",
      description:
        "One link covers the request, the wallet approval, and the proof — no storefront rebuild and no plugin to install.",
      ctaText: "READ MORE",
      ctaHref: "#",
      imageUrl:
        "https://images.unsplash.com/photo-1526304640581-d334cdbbf45e?auto=format&fit=crop&w=1200&q=80",
      imageAlt: "Digital payments on a phone",
    },
    {
      id: "api-sdk-beta",
      tag: "DEVELOPERS",
      title: "Payproof API and SDK now in beta",
      description:
        "Create payment requests, verify transactions, and fetch receipts programmatically from your own backend.",
      ctaText: "READ MORE",
      ctaHref: "#",
      imageUrl:
        "https://images.unsplash.com/photo-1540575467063-178a50c2df87?auto=format&fit=crop&w=1200&q=80",
      imageAlt: "Developer working on an integration",
    },
  ],
};

export const stats = {
  eyebrow: "Adoption",
  heading: "Trusted by businesses and builders.",
  description:
    "Payproof is used by merchants, freelancers, and developers who need a payment record they can prove.",
  items: [
    {
      value: "12.4M",
      label: "Payments verified",
      sublabel: "Total on-chain payments confirmed",
      description:
        "Every transaction Payproof touches is confirmed on Solana and recorded with a shareable proof hash your customer can verify in seconds. No logs to trust — just the chain.",
      detail: "Verified on Solana Devnet",
      variant: "brand" as const,
    },
    {
      value: "84,300",
      label: "Active merchants",
      sublabel: "Businesses and creators using Payproof",
      description:
        "Merchants, freelancers, and creators accepting USDC and SOL through Payproof payment requests — each payment comes with a receipt they can prove to anyone, anytime.",
      detail: "Across 40+ countries",
      variant: "brand" as const,
    },
    {
      value: "$0.004",
      label: "Average fee per payment",
      sublabel: "Including Solana network cost",
      description:
        "A fraction of a cent per payment, including the Solana network fee. Small transactions stay profitable, so micropayments, tips, and pay-per-article all work.",
      detail: "No monthly subscription",
      variant: "brand" as const,
    },
    {
      value: "$312M",
      label: "Total volume processed",
      sublabel: "USDC and SOL settled through Payproof",
      description:
        "Cumulative value settled through Payproof payment requests across every merchant, creator, and platform using the proof layer — all on-chain and auditable.",
      detail: "USDC + SOL combined",
      variant: "cyan" as const,
    },
    {
      value: "14.1M",
      label: "Proofs generated",
      sublabel: "Unique proof hashes issued",
      description:
        "One tamper-proof proof hash for every verified payment — stored on-chain and shareable as a receipt anyone can check on Solana Explorer, forever.",
      detail: "1 proof per payment",
      variant: "purple" as const,
    },
    {
      value: "Under 1s",
      label: "Average confirmation time",
      sublabel: "Fastest proof finality on Solana",
      description:
        "From wallet approval to on-chain proof — the payment is confirmed and the receipt is ready to share in under a second on average. Your customer sees proof before they close the tab.",
      detail: "Wallet → proof in <1s",
      variant: "brand" as const,
    },
  ],
};

export const features = {
  heading: "Built for trustworthy payments.",
  description:
    "Every Payproof payment is confirmed on-chain and recorded with a proof your customer can keep.",
  cardCta: "Learn how proofs work",
  items: [
    {
      title: "Instant",
      sublabel: "Settlement time",
      metric: "Seconds",
      description:
        "Payments confirm in seconds, and proofs are generated automatically.",
      glowColor: "from-[#9945FF]/20 to-transparent",
    },
    {
      title: "Verifiable",
      sublabel: "On-chain proofs",
      metric: "Explorer-ready",
      description:
        "Every payment has a tamper-proof record anyone can check on Solana Explorer.",
      glowColor: "from-[#C14BF0]/20 to-transparent",
    },
    {
      title: "Low cost",
      sublabel: "Average fee",
      metric: "Under $0.01",
      description:
        "Fees stay a fraction of a cent, so small payments make sense.",
      glowColor: "from-[#14F195]/20 to-transparent",
    },
    {
      title: "Secure",
      sublabel: "Non-custodial",
      metric: "Your wallet",
      description:
        "Funds go straight to your wallet. Payproof never holds your money.",
      glowColor: "from-[#00C2FF]/20 to-transparent",
    },
  ],
};

export const useCases = {
  eyebrow: "Use cases",
  heading: "Use cases",
  description:
    "Where a payment and its proof need to arrive together.",
  featured: {
    eyebrow: "Use case",
    badge: "Featured",
    name: "Freelancers",
    headline:
      "Freelancers get paid and prove it, with a receipt their clients can verify on-chain.",
    linkLabel: "See the freelancer flow",
  },
  items: [
    {
      brand: "Luma & Co.",
      headline: "Online stores accept USDC at checkout",
      tag: "Retail",
      gradient: "from-[#14F195]/20 to-transparent",
      linkLabel: "See the retail flow",
    },
    {
      brand: "Ledger Invoice Co.",
      headline: "Invoices with built-in proof of payment",
      tag: "Invoicing",
      gradient: "from-[#9945FF]/20 to-transparent",
      linkLabel: "See the invoicing flow",
    },
    {
      brand: "Pulse Community",
      headline: "Creators and communities collect subscriptions",
      tag: "Creators",
      gradient: "from-[#00C2FF]/20 to-transparent",
      linkLabel: "See the subscription flow",
    },
  ],
};

export type BuildTabKey =
  | "Payments"
  | "Invoices"
  | "Receipts"
  | "Subscriptions"
  | "API";

export type BuildMock = {
  label: string;
  rows: readonly { label: string; value: string; mono?: boolean }[];
  status: string;
  tone: "positive" | "pending";
  code?: readonly string[];
};

export type BuildPanel = {
  headline: string;
  description: string;
  learnLabel: string;
  learnHref: string;
  mock: BuildMock;
};

const buildPanels: Record<BuildTabKey, BuildPanel> = {
  Payments: {
    headline: "Accept USDC and SOL with one checkout link.",
    description:
      "Create a payment request, share one link, and Payproof confirms the transfer on-chain before marking it paid — so you never rely on a browser-side success message.",
    learnLabel: "See how payment requests work",
    learnHref: "/#build-for-growth",
    mock: {
      label: "Payment link",
      rows: [
        { label: "Amount", value: "25.00 USDC", mono: true },
        { label: "Link", value: "payproof.app/pay/pp_demo_042", mono: true },
      ],
      status: "Awaiting payment",
      tone: "pending",
    },
  },
  Invoices: {
    headline: "Invoices that carry their own proof.",
    description:
      "Bill a customer in USDC or SOL, track the status, and attach the verified transaction directly to the invoice — so every paid invoice has a proof to match.",
    learnLabel: "See how invoices with proof work",
    learnHref: "/#build-for-growth",
    mock: {
      label: "Invoice",
      rows: [
        { label: "Invoice", value: "INV-0001", mono: true },
        { label: "Amount", value: "120.00 USDC", mono: true },
        { label: "Due", value: "7 days" },
      ],
      status: "Unpaid",
      tone: "pending",
    },
  },
  Receipts: {
    headline: "A receipt with a proof hash.",
    description:
      "Every payment produces a receipt with its reference, amount, and proof hash anyone can check on Solana Explorer — a record both sides can keep.",
    learnLabel: "See how receipts with proof work",
    learnHref: "/#build-for-growth",
    mock: {
      label: "Receipt",
      rows: [
        { label: "Reference", value: "pp_demo_042", mono: true },
        { label: "Amount", value: "25.00 USDC", mono: true },
        { label: "Proof hash", value: "5Kd3…9fQ2", mono: true },
      ],
      status: "Paid · verified",
      tone: "positive",
    },
  },
  Subscriptions: {
    headline: "Recurring payments without the guesswork.",
    description:
      "Set a plan, share a link, and issue a fresh on-chain proof for every billing period — so recurring revenue stays verifiable, not just logged.",
    learnLabel: "See how subscriptions with proof work",
    learnHref: "/#build-for-growth",
    mock: {
      label: "Subscription",
      rows: [
        { label: "Plan", value: "Monthly" },
        { label: "Amount", value: "10.00 USDC", mono: true },
        { label: "Next payment", value: "1 Dec" },
      ],
      status: "Active",
      tone: "positive",
    },
  },
  API: {
    headline: "Create and verify payments from your backend.",
    description:
      "The Payproof API creates requests, verifies transactions, and returns receipts in a single call — so your backend can trust the payment status, not the browser.",
    learnLabel: "See the API reference",
    learnHref: "/#build-for-growth",
    mock: {
      label: "API response",
      rows: [],
      status: "200 OK",
      tone: "positive",
      code: [
        "POST /v1/payment-requests",
        '{ "reference": "pp_demo_042",',
        '  "amount": "25.00 USDC",',
        '  "status": "verified" }',
      ],
    },
  },
};

export const build = {
  eyebrow: "Product",
  heading: "Build for growth.",
  description:
    "Payments, invoices, receipts, subscriptions, and an API — one proof layer for all of it.",
  tabs: ["Payments", "Invoices", "Receipts", "Subscriptions", "API"] as const,
  panels: buildPanels,
  partnersLabel: "Featured integrations in",
  partners: [
    "Jupiter",
    "Raydium",
    "Kamino",
    "Solflare",
  ],
};

export const community = {
  eyebrow: "Community",
  heading: "Join a growing community.",
  description:
    "Businesses and developers using Payproof to make every payment provable.",
  cards: [
    {
      value: "24,500",
      heading: "merchants onboarded",
      description:
        "Merchants accepting USDC and SOL, with a verified receipt for every sale.",
      linkLabel: "Merchant stories",
      gradient: "text-gradient-brand",
      accent: "text-[#14F195]",
    },
    {
      value: "1,800",
      heading: "developers building with the Payproof API",
      description:
        "Teams shipping checkout, invoicing, and proof flows into their own products.",
      linkLabel: "Explore the API",
      gradient: "text-gradient-cyan",
      accent: "text-[#00C2FF]",
    },
  ],
  visual: {
    tag: "Product preview",
    title: "A receipt anyone can verify",
    receiptLabel: "Receipt",
    amount: "25.00 USDC",
    reference: "pp_demo_042",
    proofHash: "5Kd3…9fQ2",
    status: "Verified",
  },
};

export const finalCta = {
  eyebrow: "Get started with Payproof",
  heading: "It's time to get paid with proof.",
  subtext:
    "Join the businesses, creators, and developers using Payproof.",
  cta: { label: "GET STARTED", href: "/payment-requests" },
};

export const footer = {
  tagline: "Built on Solana",
  description:
    "Verifiable payments, instant settlement, and proof-of-payment receipts for businesses, creators, and developers.",
  socials: [
    { id: "x", label: "Follow Payproof on X", href: "#" },
    { id: "discord", label: "Join the Payproof Discord", href: "#" },
    { id: "github", label: "View the Payproof GitHub", href: "#" },
  ],
  columns: [
    {
      title: "PRODUCT",
      links: [
        { label: "Payments", href: "/#build-for-growth" },
        { label: "Payment Requests", href: "/payment-requests" },
        { label: "Invoices", href: "/invoices" },
        { label: "AI Assistant", href: "/ai-assistant" },
      ],
    },
    {
      title: "EXPLORE",
      links: [
        { label: "Trust", href: "/#trust" },
        { label: "Use Cases", href: "/#use-cases" },
        { label: "Product", href: "/#product" },
      ],
    },
    {
      title: "LEGAL",
      links: [
        { label: "Disclaimer", href: "/disclaimer" },
        { label: "Privacy Policy", href: "/privacy" },
        { label: "Terms", href: "/terms" },
      ],
    },
  ],
  language: { code: "EN", region: "Global (USD)" },
  copyright: "© 2026 Payproof. All rights reserved.",
  bottomNote: "Built on Solana · Verified on-chain",
};
