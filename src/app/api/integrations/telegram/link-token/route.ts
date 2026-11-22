import { NextRequest, NextResponse } from "next/server";
import { createSupabaseClient } from "@/lib/payment-requests/supabase";
import { requireMerchant } from "@/lib/auth";
import {
  checkClientRateLimit,
  checkWalletRateLimit,
  TELEGRAM_LINK_RATE_LIMIT_MESSAGE,
  TELEGRAM_LINK_RATE_LIMIT_UNAVAILABLE_MESSAGE,
} from "@/lib/auth/rate-limit";
import {
  generateLinkToken,
  resolveLinkTokenOutcome,
  type LinkTokenOutcome,
  type LinkTokenRpcResult,
} from "@/lib/telegram/link-token";

// ---------------------------------------------------------------------------
// POST /api/integrations/telegram/link-token
//
// Issues a single-use Telegram linking token for the authenticated merchant.
//
//   1. requireMerchant — the wallet comes from the session, never the request.
//   2. telegram-link-token rate limits (client IP and wallet buckets).
//   3. Generate 32 random bytes and hash them here; only the hash is stored.
//   4. atomic_generate_telegram_link_token serialises per merchant, revokes any
//      previous token, and inserts the new hash with a 15-minute expiry.
//   5. Build the deep link only after the database reports success.
//
// When the database reports a retryable collision (`hash_conflict` or
// `conflict`), a fresh token is generated and the call is retried once, as the
// SQL contract instructs. The raw token is never persisted or logged, and it
// only appears in a successful deep link.
// ---------------------------------------------------------------------------

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" } as const;

/** One retry: only retryable collisions ever trigger a second attempt. */
const MAX_TOKEN_ATTEMPTS = 2;

type RpcAttempt =
  | { failed: true }
  | { failed: false; data: LinkTokenRpcResult };

async function requestToken(
  merchantAddress: string,
  tokenHash: string
): Promise<RpcAttempt> {
  try {
    const supabase = createSupabaseClient();
    const { data, error } = await supabase.rpc(
      "atomic_generate_telegram_link_token",
      {
        p_merchant_wallet_address: merchantAddress,
        p_token_hash: tokenHash,
      }
    );

    if (error) {
      // Log RPC error safely — no secrets.
      console.error("[telegram/link-token] RPC error exists:", error != null);
      if (error) {
        console.error("[telegram/link-token] RPC error message:", error.message);
        console.error("[telegram/link-token] RPC error code:", error.code);
      }
      return { failed: true };
    }

    // Normalize RPC result: Supabase returns an array of rows (the SQL function
    // uses `return query select`), so take the first row if present.
    const rpcResult = Array.isArray(data) ? data[0] : data;

    // Handle null/undefined result from RPC.
    if (!rpcResult) {
      console.error("[telegram/link-token] RPC returned no result data");
      return { failed: true };
    }

    // Safely read status from the normalized result.
    const rpcStatus = rpcResult.status;

    // Log RPC status safely — no secrets echoed.
    if (rpcStatus !== undefined) {
      console.log("[telegram/link-token] RPC status:", rpcStatus);
    }

    return { failed: false, data: rpcResult as LinkTokenRpcResult };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    const code = error instanceof Error ? (error as any)?.code ?? "unknown" : "unknown";
    console.error("[telegram/link-token] RPC threw:", message, "code:", code);
    return { failed: true };
  }
}

export async function POST(request: NextRequest) {
  const merchantAddress = await requireMerchant(request);
  if (typeof merchantAddress !== "string") {
    return merchantAddress;
  }

  // Client IP bucket first, then the wallet bucket.
  const clientLimit = await checkClientRateLimit(
    "telegram-link-token",
    request.headers
  );
  if (!clientLimit.ok) {
    return NextResponse.json(
      { error: TELEGRAM_LINK_RATE_LIMIT_MESSAGE },
      { status: 429, headers: NO_STORE }
    );
  }

  const walletLimit = await checkWalletRateLimit(
    "telegram-link-token",
    merchantAddress
  );
  if (!walletLimit.ok) {
    return NextResponse.json(
      { error: TELEGRAM_LINK_RATE_LIMIT_MESSAGE },
      { status: 429, headers: NO_STORE }
    );
  }

  let outcome: LinkTokenOutcome | null = null;

  for (let attempt = 1; attempt <= MAX_TOKEN_ATTEMPTS; attempt += 1) {
    const { rawToken, tokenHash } = generateLinkToken();
    const result = await requestToken(merchantAddress, tokenHash);

    if (result.failed) {
      return NextResponse.json(
        { error: TELEGRAM_LINK_RATE_LIMIT_UNAVAILABLE_MESSAGE },
        { status: 503, headers: NO_STORE }
      );
    }

    outcome = resolveLinkTokenOutcome(result.data, rawToken);

    if (outcome.ok || !outcome.retryable || attempt === MAX_TOKEN_ATTEMPTS) {
      break;
    }
  }

  if (!outcome) {
    return NextResponse.json(
      { error: TELEGRAM_LINK_RATE_LIMIT_UNAVAILABLE_MESSAGE },
      { status: 503, headers: NO_STORE }
    );
  }

  return NextResponse.json(outcome.body, {
    status: outcome.status,
    headers: NO_STORE,
  });
}
