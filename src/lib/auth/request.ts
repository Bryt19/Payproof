import type { NextRequest } from "next/server";

export async function parseChallenge(
  request: NextRequest,
): Promise<
  | { ok: true; value: { body: { walletAddress: string } } }
  | { ok: false; message: string }
> {
  try {
    const body = await request.json();
    const walletAddress =
      typeof body?.walletAddress === "string" ? body.walletAddress.trim() : "";

    if (!walletAddress) {
      return { ok: false, message: "walletAddress is required" };
    }

    return {
      ok: true,
      value: { body: { walletAddress } },
    };
  } catch {
    return { ok: false, message: "Invalid JSON request body" };
  }
}

export async function parseVerify(
  request: NextRequest,
): Promise<
  | {
      ok: true;
      value: {
        body: {
          nonce: string;
          domain: string;
          walletAddress: string;
          signature: string;
        };
      };
    }
  | { ok: false; message: string }
> {
  try {
    const body = await request.json();
    const nonce = typeof body?.nonce === "string" ? body.nonce.trim() : "";
    const domain = typeof body?.domain === "string" ? body.domain.trim() : "";
    const walletAddress =
      typeof body?.walletAddress === "string" ? body.walletAddress.trim() : "";
    const signature =
      typeof body?.signature === "string" ? body.signature.trim() : "";

    if (!nonce || !domain || !walletAddress || !signature) {
      return {
        ok: false,
        message: "nonce, domain, walletAddress, and signature are required",
      };
    }

    return {
      ok: true,
      value: {
        body: {
          nonce,
          domain,
          walletAddress,
          signature,
        },
      },
    };
  } catch {
    return { ok: false, message: "Invalid JSON request body" };
  }
}
