import { NextRequest, NextResponse } from "next/server";
import { createAuthEnvironment } from "@/lib/auth";
import { createMerchantAuthService } from "@/lib/auth";
import { clearMerchantSessionCookie } from "@/lib/auth";
import { MerchantAuthEnvironmentError } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const env = createAuthEnvironment();
    const service = await createMerchantAuthService(env);
    const token = request.cookies.get(env.cookieName)?.value;

    if (token) {
      await service.invalidateSession(token);
    }

    // Same reasoning as `/api/auth/verify`: an unawaited cookie mutation is
    // finalized after the handler returns, so the clearing Set-Cookie is lost.
    await clearMerchantSessionCookie(env.cookieMaxAgeSeconds);

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error) {
    if (error instanceof MerchantAuthEnvironmentError) {
      return NextResponse.json(
        { error: "Authentication is not configured on the server." },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { error: "Logout is temporarily unavailable." },
      { status: 503 },
    );
  }
}
