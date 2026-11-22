import { NextRequest, NextResponse } from "next/server";
import { createAuthEnvironment } from "@/lib/auth";
import {
  buildChallengeMessage,
  createMerchantAuthService,
  MerchantAuthChallengeError,
} from "@/lib/auth";
import { MerchantAuthEnvironmentError } from "@/lib/auth";
import { parseChallenge } from "@/lib/auth/request";
import {
  checkClientRateLimit,
  checkWalletRateLimit,
  rateLimitResponseInit,
} from "@/lib/auth/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  // Client-identity limits run before the body is read, so malformed or invalid
  // requests are counted against the same bucket as well-formed ones.
  const clientLimit = await checkClientRateLimit("challenge", request.headers);
  if (!clientLimit.ok) {
    const init = rateLimitResponseInit(clientLimit);
    return NextResponse.json(init.body, {
      status: init.status,
      headers: init.headers,
    });
  }

  const parsed = await parseChallenge(request);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.message }, { status: 422 });
  }

  const walletAddress = parsed.value.body.walletAddress;

  // Wallet limits run only once the address is known and validated.
  const walletLimit = await checkWalletRateLimit("challenge", walletAddress);
  if (!walletLimit.ok) {
    const init = rateLimitResponseInit(walletLimit);
    return NextResponse.json(init.body, {
      status: init.status,
      headers: init.headers,
    });
  }

  try {
    const env = createAuthEnvironment();
    const service = await createMerchantAuthService(env);

    const challenge = await service.createChallenge(walletAddress);
    if (challenge instanceof MerchantAuthChallengeError) {
      return NextResponse.json(
        { error: "Could not create an authentication challenge.", retryable: true },
        { status: 503 },
      );
    }

    return NextResponse.json(
      {
        nonce: challenge.nonce,
        expiresAt: challenge.expiresAt.toISOString(),
        domain: env.domain,
        // The exact payload to sign. The server rebuilds it from the stored
        // nonce and domain during verification; the client only signs it.
        message: buildChallengeMessage(env.domain, challenge.nonce),
      },
      {
        status: 201,
        headers: { "cache-control": "no-store" },
      },
    );
  } catch (error) {
    if (error instanceof MerchantAuthEnvironmentError) {
      return NextResponse.json(
        { error: "Authentication is not configured on the server." },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { error: "Authentication is temporarily unavailable." },
      { status: 503 },
    );
  }
}
