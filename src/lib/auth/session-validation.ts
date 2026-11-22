import {
  createMerchantAuthService,
  type AuthEnvironment,
} from "./merchant-auth-service";
import { createAuthEnvironment } from "./index";

export type MerchantSessionState =
  | { authenticated: true; walletAddress: string }
  | {
      authenticated: false;
      reason:
        | "no-session"
        | "invalid-session"
        | "expired-session"
        | "configuration-error";
      message?: string;
    };

export async function validateMerchantSessionToken(
  token?: string,
  env?: AuthEnvironment,
): Promise<MerchantSessionState> {
  if (!token || token.trim().length === 0) {
    return { authenticated: false, reason: "no-session" };
  }

  let activeEnv: AuthEnvironment;
  try {
    activeEnv = env ?? createAuthEnvironment();
  } catch {
    return { authenticated: false, reason: "configuration-error" };
  }

  try {
    const service = await createMerchantAuthService(activeEnv);
    const result = await service.validateSession(token);

    if (result.ok) {
      return { authenticated: true, walletAddress: result.walletAddress };
    }

    if (result.kind === "expired") {
      return { authenticated: false, reason: "expired-session" };
    }

    return { authenticated: false, reason: "invalid-session" };
  } catch {
    return { authenticated: false, reason: "configuration-error" };
  }
}
