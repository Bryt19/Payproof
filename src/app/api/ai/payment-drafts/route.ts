import { createPaymentDraftPostHandler } from "@/lib/ai/payment-draft-handler";

/**
 * POST /api/ai/payment-drafts
 *
 * Authenticated draft preparation only. The request is scoped to the merchant
 * session cookie; the body cannot supply a wallet. Successful responses carry
 * a signed, 10-minute draft token for the later review/confirmation flow, but
 * no payment request exists until a separate execute endpoint is added.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = createPaymentDraftPostHandler();
