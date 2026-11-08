import { NextRequest, NextResponse } from "next/server";
import type { Invoice, InvoiceStatus } from "@/lib/invoices/types";

/**
 * In-memory invoice store for the invoices list page.
 *
 * This is a UI-only placeholder until a real backing store is connected. The
 * shape matches the Invoice type already used by the frontend, and the list
 * endpoint accepts the same query parameters the invoices page sends.
 */

type SortField = "issued_at" | "due_at" | "amount" | "number";
type SortDirection = "asc" | "desc";

interface ListOptions {
  search?: string;
  status?: string;
  sortField: SortField;
  sortDirection: SortDirection;
  limit: number;
  offset: number;
}

function parseSortField(raw: string): SortField {
  if (raw === "due_at" || raw === "amount" || raw === "number") return raw as SortField;
  return "issued_at";
}

function parseSortDirection(raw: string): SortDirection {
  return raw === "asc" ? "asc" : "desc";
}

function normalizeStatus(raw: string | undefined): string | undefined {
  if (!raw || raw === "all") return undefined;
  const allowed: InvoiceStatus[] = [
    "draft",
    "sent",
    "viewed",
    "paid",
    "overdue",
    "cancelled",
    "void",
  ];
  return allowed.includes(raw as InvoiceStatus) ? raw : undefined;
}

function matchesSearch(invoice: Invoice, query: string): boolean {
  const q = query.toLowerCase();
  return (
    invoice.number.toLowerCase().includes(q) ||
    invoice.customerName.toLowerCase().includes(q) ||
    invoice.customerEmail.toLowerCase().includes(q) ||
    invoice.description.toLowerCase().includes(q)
  );
}

function sortInvoices(invoices: Invoice[], field: SortField, direction: SortDirection): Invoice[] {
  const sorted = [...invoices].sort((a, b) => {
    let comparison = 0;
    if (field === "issued_at") {
      comparison = a.issueDate.localeCompare(b.issueDate);
    } else if (field === "due_at") {
      comparison = a.dueDate.localeCompare(b.dueDate);
    } else if (field === "amount") {
      comparison = BigInt(a.amountLamports) < BigInt(b.amountLamports) ? -1 : BigInt(a.amountLamports) > BigInt(b.amountLamports) ? 1 : 0;
    } else if (field === "number") {
      comparison = a.number.localeCompare(b.number);
    }
    return direction === "desc" ? -comparison : comparison;
  });
  return sorted;
}

function parsePositiveInt(value: string | null | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return parsed;
}

function parseNonNegativeInt(value: string | null | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  const searchRaw = params.get("search") ?? undefined;
  const search = searchRaw?.trim() || undefined;
  const status = normalizeStatus(params.get("status") ?? undefined);
  const sortField = parseSortField(params.get("sortField") ?? "issued_at");
  const sortDirection = parseSortDirection(params.get("sortDirection") ?? "desc");
  const limit = Math.min(parsePositiveInt(params.get("limit") ?? undefined, 50), 100);
  const offset = parseNonNegativeInt(params.get("offset") ?? undefined, 0);

  const store = getInvoiceStore();

  let list: Invoice[] = [...store.values];

  if (search) {
    list = list.filter((invoice) => matchesSearch(invoice, search ?? ""));
  }

  if (status) {
    list = list.filter((invoice) => invoice.status === status);
  }

  list = sortInvoices(list, sortField, sortDirection);

  const total = list.length;
  const page = list.slice(offset, offset + limit);

  return NextResponse.json(
    {
      invoices: page,
      total,
      limit,
      offset,
      hasMore: offset + page.length < total,
    },
    { status: 200 },
  );
}

// ---------------------------------------------------------------------------
// In-memory store
// ---------------------------------------------------------------------------

let store: InvoiceStore | null = null;

function getInvoiceStore(): InvoiceStore {
  if (store) return store;

  store = createDefaultInvoiceStore();
  return store;
}

function createDefaultInvoiceStore(): InvoiceStore {
  const seed: Invoice[] = [
    {
      id: "inv-1",
      number: "INV-0001-A3F2",
      customerName: "Ada Nwosu",
      customerEmail: "ada@example.com",
      description: "Website redesign - homepage and landing pages",
      lineItems: [
        { description: "Homepage mockup", quantity: 1, unitPrice: 450 },
        { description: "Landing page design", quantity: 2, unitPrice: 300 },
      ],
      currency: "USD",
      amountCents: "105000",
      amountLamports: "105000000000",
      issueDate: "2026-11-01T00:00:00.000Z",
      dueDate: "2026-11-15T00:00:00.000Z",
      status: "paid",
      notes: "Payment confirmed on Solana Devnet.",
      createdAt: "2026-11-01T09:12:00.000Z",
    },
    {
      id: "inv-2",
      number: "INV-0002-7B1C",
      customerName: "Kofi Mensah",
      customerEmail: "kofi@example.com",
      description: "Mobile app backend integration",
      lineItems: [
        { description: "API integration", quantity: 1, unitPrice: 1200 },
        { description: "Documentation", quantity: 1, unitPrice: 200 },
      ],
      currency: "USD",
      amountCents: "140000",
      amountLamports: "140000000000",
      issueDate: "2026-11-03T00:00:00.000Z",
      dueDate: "2026-11-17T00:00:00.000Z",
      status: "sent",
      notes: null,
      createdAt: "2026-11-03T14:05:00.000Z",
    },
    {
      id: "inv-3",
      number: "INV-0003-4D9E",
      customerName: "Zara Okafor",
      customerEmail: "zara@example.com",
      description: "UI audit and accessibility review",
      lineItems: [
        { description: "Accessibility audit", quantity: 1, unitPrice: 600 },
      ],
      currency: "USD",
      amountCents: "60000",
      amountLamports: "60000000000",
      issueDate: "2026-10-20T00:00:00.000Z",
      dueDate: "2026-11-03T00:00:00.000Z",
      status: "overdue",
      notes: "Payment is past due.",
      createdAt: "2026-10-20T11:30:00.000Z",
    },
    {
      id: "inv-4",
      number: "INV-0004-C21F",
      customerName: "Tunde Balogun",
      customerEmail: "tunde@example.com",
      description: "Branding package - logo and collateral",
      lineItems: [
        { description: "Logo design", quantity: 1, unitPrice: 800 },
        { description: "Brand guidelines", quantity: 1, unitPrice: 400 },
      ],
      currency: "USD",
      amountCents: "120000",
      amountLamports: "120000000000",
      issueDate: "2026-10-28T00:00:00.000Z",
      dueDate: "2026-11-11T00:00:00.000Z",
      status: "viewed",
      notes: null,
      createdAt: "2026-10-28T08:45:00.000Z",
    },
    {
      id: "inv-5",
      number: "INV-0005-98E3",
      customerName: "Imani Roberts",
      customerEmail: "imani@example.com",
      description: "Smart contract review",
      lineItems: [
        { description: "Security review", quantity: 1, unitPrice: 2000 },
      ],
      currency: "SOL",
      amountCents: "0",
      amountLamports: "2000000000",
      issueDate: "2026-11-04T00:00:00.000Z",
      dueDate: "2026-11-18T00:00:00.000Z",
      status: "draft",
      notes: "Awaiting client confirmation.",
      createdAt: "2026-11-04T16:20:00.000Z",
    },
  ];

  return { values: seed };
}

type InvoiceStore = {
  values: readonly Invoice[];
};
