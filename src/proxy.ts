import { NextResponse, type NextRequest } from "next/server";

import { MERCHANT_AUTH_COOKIE_NAME } from "@/lib/auth/cookie-name";
import { isMerchantConsolePath } from "@/lib/auth/console-routes";
import { validateMerchantSessionToken } from "@/lib/auth/session-validation";

/**
 * Session gate that runs before the console renders.
 *
 * A redirect thrown from a layout can only be sent after the response has begun
 * streaming, which produced a one-second `meta` refresh. The proxy runs before
 * any rendering, so an anonymous or stale session gets a real 307 here instead.
 *
 * This is the *same* validation used by `DashboardGate` and the merchant APIs —
 * `validateMerchantSessionToken` hashes the cookie and checks the `merchant_auth`
 * record. Cookie presence alone never grants access. The per-layout check stays
 * in place as defence in depth for anything rendered inside the app.
 *
 * Public routes (landing, `/pay/[reference]` checkout, payment verification,
 * legal pages) are not matched and are unaffected.
 */

function redirectToLogin(request: NextRequest, clearCookie: boolean): NextResponse {
  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = "";

  const response = NextResponse.redirect(loginUrl);

  // The cookie failed validation: drop it so the login page does not present a
  // stale session. The database record is left untouched.
  if (clearCookie) {
    response.cookies.delete(MERCHANT_AUTH_COOKIE_NAME);
  }

  return response;
}

export default async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (!isMerchantConsolePath(pathname)) {
    return NextResponse.next();
  }

  const token = request.cookies.get(MERCHANT_AUTH_COOKIE_NAME)?.value;

  if (!token) {
    return redirectToLogin(request, false);
  }

  const session = await validateMerchantSessionToken(token);

  if (session.authenticated) {
    return NextResponse.next();
  }

  if (session.reason === "configuration-error") {
    // A misconfigured server cannot validate anything. Let the page render the
    // explanatory gate instead of bouncing between /login and the console.
    return NextResponse.next();
  }

  return redirectToLogin(request, true);
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/payments/:path*",
    "/payment-requests/:path*",
    "/invoices/:path*",
    "/notifications/:path*",
    "/ai-assistant/:path*",
    "/settings/:path*",
  ],
};
