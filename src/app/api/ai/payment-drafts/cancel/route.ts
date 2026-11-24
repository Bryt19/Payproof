import { createPaymentDraftCancelHandler } from "@/lib/ai/payment-draft-cancel-handler";

/**
 * POST /api/ai/payment-drafts/cancel
 *
 * Revokes the authorization behind a signed draft token for the authenticated
 * merchant. Does not create, consume or modify a payment request, and is safe
 * to repeat.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = createPaymentDraftCancelHandler();
