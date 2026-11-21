import { NextRequest, NextResponse } from "next/server";
import { createAuthEnvironment } from "@/lib/auth";
import { createMerchantAuthService } from "@/lib/auth";
import { setMerchantSessionCookie } from "@/lib/auth";
import { MerchantAuthEnvironmentError } from "@/lib/auth";
import { parseVerify } from "@/lib/auth/request";
import {
  checkClientRateLimit,
  checkWalletRateLimit,
  rateLimitResponseInit,
} from "@/lib/auth/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  // Client-identity limits run before the body is read, so malformed or invalid
  // signature submissions are counted against the same bucket as valid ones.
  const clientLimit = await checkClientRateLimit("verify", request.headers);
  if (!clientLimit.ok) {
    const init = rateLimitResponseInit(clientLimit);
    return NextResponse.json(init.body, {
      status: init.status,
      headers: init.headers,
    });
  }

  const parsed = await parseVerify(request);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.message }, { status: 422 });
  }

  const { nonce, domain, walletAddress, signature } = parsed.value.body;

  // Wallet limits run only once the address is known and validated.
  const walletLimit = await checkWalletRateLimit("verify", walletAddress);
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

    // The authoritative message is rebuilt server-side from the stored
    // challenge nonce and domain. We only decode the client-supplied signature
    // (base64 -> hex) for verification; we do not trust a client-supplied
    // message as the challenge message.
    const signatureHex = Buffer.from(signature, "base64").toString("hex");

    const verified = await service.consumeChallenge(
      nonce,
      domain,
      walletAddress,
      signatureHex,
    );

    if (!verified.ok) {
      const status: Record<string, number> = {
        expired: 410,
        already_used: 409,
        invalid_signature: 400,
        unknown_challenge: 404,
      };
      return NextResponse.json(
        { error: verified.message, kind: verified.kind },
        { status: status[verified.kind] ?? 400 },
      );
    }

    // Must be awaited: Next.js only merges cookies mutated through `cookies()`
    // into the response while the handler is still running. A floating promise
    // here lets the handler return first, and the Set-Cookie header is dropped.
    await setMerchantSessionCookie(verified.sessionToken, env.cookieMaxAgeSeconds);

    return NextResponse.json(
      {
        ok: true,
        walletAddress: verified.walletAddress,
        sessionExpiresAt: new Date(Date.now() + env.cookieMaxAgeSeconds * 1000).toISOString(),
      },
      {
        status: 200,
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
      { error: "Authentication verification is temporarily unavailable." },
      { status: 503 },
    );
  }
}
