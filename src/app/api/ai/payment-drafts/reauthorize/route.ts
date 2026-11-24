import { createPaymentDraftReauthorizeHandler } from "@/lib/ai/payment-draft-reauthorize-handler";

/**
 * POST /api/ai/payment-drafts/reauthorize
 *
 * Re-signs an edited, still-active draft for the authenticated merchant and
 * revokes the previous nonce atomically. Does not create a payment request.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = createPaymentDraftReauthorizeHandler();
