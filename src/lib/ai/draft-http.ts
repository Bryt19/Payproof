import { NextRequest, NextResponse } from "next/server";

/** Shared HTTP guards for the AI payment-draft write endpoints. */

export const DRAFT_NO_STORE = { "cache-control": "no-store" } as const;

/** Max body for the execute and re-authorize endpoints (token + review fields). */
export const MAX_DRAFT_BODY_BYTES = 8 * 1024;

/** Max body for draft preparation, which may carry a bounded conversation. */
export const MAX_DRAFT_PREPARE_BODY_BYTES = 64 * 1024;

export const DRAFT_BODY_TOO_LARGE_MESSAGE = "The request body is too large.";

export type DraftJsonBodyResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; reason: "too_large" | "invalid" };

/**
 * Reads a JSON object body with a hard byte limit.
 *
 * `request.json()` buffers whatever the caller sends, so every draft endpoint
 * reads the body through this helper instead. The `content-length` header is
 * only an early hint (it can be absent or wrong), so the limit is enforced
 * again on the decoded text.
 */
export async function readDraftJsonBody(
  request: Request,
  maxBytes: number = MAX_DRAFT_BODY_BYTES,
): Promise<DraftJsonBodyResult> {
  const declaredHeader = request.headers.get("content-length");
  const declaredLength = declaredHeader === null ? Number.NaN : Number(declaredHeader);

  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    return { ok: false, reason: "too_large" };
  }

  let text: string;

  try {
    text = await request.text();
  } catch {
    return { ok: false, reason: "invalid" };
  }

  if (Buffer.byteLength(text, "utf8") > maxBytes) {
    return { ok: false, reason: "too_large" };
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: "invalid" };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, reason: "invalid" };
  }

  return { ok: true, body: parsed as Record<string, unknown> };
}

export function draftJson(
  body: Record<string, unknown>,
  status = 200,
): NextResponse {
  return NextResponse.json(body, { status, headers: DRAFT_NO_STORE });
}

export function hasJsonContentType(request: NextRequest): boolean {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  return contentType.startsWith("application/json");
}

/**
 * Rejects browser cross-site requests. Non-browser clients normally omit both
 * headers; the session cookie is httpOnly + SameSite=Lax and a JSON request
 * requires a CORS preflight, so absence is not treated as cross-site.
 */
export function isSameOriginRequest(request: NextRequest): boolean {
  const fetchSite = request.headers.get("sec-fetch-site");

  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    return false;
  }

  const origin = request.headers.get("origin");
  if (!origin) return true;

  try {
    const parsed = new URL(origin);
    const configuredDomain = process.env.APP_DOMAIN?.trim();

    return (
      parsed.host === request.nextUrl.host ||
      (Boolean(configuredDomain) && parsed.host === configuredDomain)
    );
  } catch {
    return false;
  }
}
