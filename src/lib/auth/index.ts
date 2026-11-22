import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseClient } from "@/lib/payment-requests/supabase";
import { MERCHANT_AUTH_COOKIE_NAME } from "./cookie-name";
import {
  type AuthEnvironment,
  MerchantAuthChallengeError,
  MerchantAuthEnvironmentError,
  type MerchantAuthService,
  MerchantAuthVerifyError,
  buildChallengeMessage,
  createMerchantAuthService,
  hashSessionToken,
} from "./merchant-auth-service";
import { validateMerchantSessionToken } from "./session-validation";

export * from "./cookie-name";
export * from "./console-routes";
export * from "./session-validation";
export * from "./merchant-auth-service";

export function createAuthEnvironment(): AuthEnvironment {
  const supabase = createSupabaseClient();
  const domain =
    process.env.APP_DOMAIN ||
    process.env.NEXT_PUBLIC_APP_URL?.replace(/^https?:\/\//, "") ||
    "localhost";

  return {
    domain,
    supabase,
    cookieMaxAgeSeconds: 7 * 24 * 60 * 60, // 7 days
    sessionMaxAgeSeconds: 7 * 24 * 60 * 60,
    cookieName: MERCHANT_AUTH_COOKIE_NAME,
  };
}

export async function setMerchantSessionCookie(
  sessionToken: string,
  maxAgeSeconds: number,
): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(MERCHANT_AUTH_COOKIE_NAME, sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: maxAgeSeconds,
  });
}

export async function clearMerchantSessionCookie(
  maxAgeSeconds = 0,
): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(MERCHANT_AUTH_COOKIE_NAME);
}

export async function resolveMerchant(
  request: NextRequest,
): Promise<
  | { ok: true; walletAddress: string }
  | { ok: false; kind: string; message: string }
> {
  const token = request.cookies.get(MERCHANT_AUTH_COOKIE_NAME)?.value;
  const env = createAuthEnvironment();
  const session = await validateMerchantSessionToken(token, env);

  if (session.authenticated) {
    return { ok: true, walletAddress: session.walletAddress };
  }

  return {
    ok: false,
    kind: session.reason,
    message:
      session.reason === "configuration-error"
        ? "Authentication is misconfigured on the server."
        : "No active merchant session.",
  };
}

export async function requireMerchant(
  request: NextRequest,
): Promise<string | NextResponse> {
  const resolved = await resolveMerchant(request);
  if (resolved.ok) {
    return resolved.walletAddress;
  }

  if (resolved.kind === "configuration-error") {
    return NextResponse.json(
      { error: "Authentication service unavailable." },
      { status: 503 },
    );
  }

  return NextResponse.json(
    { error: "Authentication required." },
    { status: 401 },
  );
}
