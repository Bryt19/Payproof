import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type ServerSupabaseClient = SupabaseClient;

export class SupabaseConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SupabaseConfigurationError";

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, SupabaseConfigurationError);
    }
  }
}

function makeClient(): ServerSupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (typeof url !== "string" || url.trim().length === 0) {
    throw new SupabaseConfigurationError("NEXT_PUBLIC_SUPABASE_URL is not configured.");
  }

  if (typeof serviceRoleKey !== "string" || serviceRoleKey.trim().length === 0) {
    throw new SupabaseConfigurationError("SUPABASE_SERVICE_ROLE_KEY is not configured.");
  }

  return createClient(url.trim(), serviceRoleKey, {
    auth: {
      persistSession: false,
    },
  });
}

let cachedClient: ServerSupabaseClient | null = null;

export function createSupabaseClient(): ServerSupabaseClient {
  if (cachedClient) {
    return cachedClient;
  }

  cachedClient = makeClient();
  return cachedClient;
}

