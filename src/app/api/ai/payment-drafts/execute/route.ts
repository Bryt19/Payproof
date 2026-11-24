import { createPaymentDraftExecuteHandler } from "@/lib/ai/payment-draft-execute-handler";

/**
 * POST /api/ai/payment-drafts/execute
 *
 * Consumes a signed authorization and creates exactly one payment request.
 * The token payload is authoritative; request-body draft fields and wallets
 * are ignored. Retries against a consumed nonce return the original request.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = createPaymentDraftExecuteHandler();
