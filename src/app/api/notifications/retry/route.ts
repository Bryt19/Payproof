import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  checkNotificationPreference,
  deliverNotificationToTelegram,
  resolveActiveTelegramLink,
} from "@/lib/notifications/server";
import { readTelegramBotToken } from "@/lib/notifications/telegram";
import type { NotificationType } from "@/lib/notifications/types";

export const maxDuration = 30;

export const dynamic = "force-dynamic";

/** Bounded batch: keep one invocation well inside the serverless limit. */
const MAX_BATCH = 20;
/** Stop starting new deliveries once this much wall time has been used. */
const MAX_RUNTIME_MS = 30_000;

function getSupabase(): SupabaseClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Supabase runtime env vars missing");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
}

/** Constant-time comparison for Vercel Cron authorization. 
 * Supports Vercel's standard `Authorization: Bearer <CRON_SECRET>` header,
 * with backward-compatible fallback to the `x-cron-secret` header.
 * Both paths use `crypto.timingSafeEqual` to prevent timing attacks.
 */
function isAuthorized(request: NextRequest, secret: string): boolean {
  // Primary: Vercel Cron standard – Authorization: Bearer <CRON_SECRET>
  const authHeader = request.headers.get("authorization");
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const provided = Buffer.from(authHeader.slice(7), "utf8");
    const expected = Buffer.from(secret, "utf8");
    if (provided.length !== expected.length) return false;
    return timingSafeEqual(provided, expected);
  }

  // Backward-compatible fallback – x-cron-secret header.
  const header = request.headers.get("x-cron-secret") ?? "";
  const provided = Buffer.from(header, "utf8");
  const expected = Buffer.from(secret, "utf8");
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

/**
 * Re-drive one eligible delivery through the normal pipeline.
 *
 * The attempt budget is owned by `deliverNotificationToTelegram`, which reads
 * the persisted `attempt` count and only spends what remains. This function
 * must never reset or increment `attempt` itself — doing so would let a
 * scheduled retry bypass the shared three-request limit.
 */
async function attemptDelivery(
  db: SupabaseClient,
  notificationId: string,
  merchantAddress: string,
  eventType: NotificationType,
): Promise<void> {
  // Re-check preference and link before sending — the merchant may have
  // disabled the preference or unlinked Telegram since the original send.
  const enabled = await checkNotificationPreference(db, merchantAddress, eventType);
  if (enabled !== true) {
    console.log(
      `[cron] preference disabled for merchant ${merchantAddress} / event ${eventType}`,
    );
    return;
  }

  if (!readTelegramBotToken()) {
    console.warn("[cron] Telegram delivery skipped: bot token unavailable");
    return;
  }

  const link = await resolveActiveTelegramLink(db, merchantAddress);
  if (!link) {
    console.log(`[cron] no active Telegram link for merchant ${merchantAddress}`);
    // Record the reason without touching the attempt counter. The row stays
    // eligible while budget remains, so a restored link can be retried.
    await db
      .from("notification_deliveries")
      .update({ status: "failed", error_message: "no active Telegram link" })
      .eq("notification_id", notificationId)
      .neq("status", "delivered");
    return;
  }

  const result = await deliverNotificationToTelegram(db, {
    notificationId,
    merchantAddress,
    eventType,
    payload: { reference: "", amountLamports: "0" },
    sendOptions: {},
  });

  console.log(
    result.performed
      ? "[cron] delivery performed"
      : `[cron] delivery not performed: ${result.reason}`,
  );
}

async function runRetry(request: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[cron] CRON_SECRET is not configured — retry endpoint disabled");
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }

  if (!isAuthorized(request, secret)) {
    console.warn("[cron] unauthorized request rejected");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const db = getSupabase();

    const startMs = Date.now();

    const { data: candidates, error: listError } = await db
      .rpc("get_eligible_deliveries")
      .limit(MAX_BATCH);

    if (listError) {
      console.error(
        "[cron] failed to list eligible deliveries (will retry from start next invocation)",
      );
      return NextResponse.json({ error: "internal error" }, { status: 500 });
    }

    if (!candidates || candidates.length === 0) {
      return NextResponse.json({ recovered: 0, message: "no eligible deliveries" });
    }

    const results: Array<{ notificationId: string; ok: boolean }> = [];

    for (const row of candidates) {
      if (Date.now() - startMs > MAX_RUNTIME_MS) {
        console.log(
          `[cron] runtime budget exceeded, stopping after ${results.length} of ${candidates.length} deliveries`,
        );
        break;
      }

      try {
        await attemptDelivery(
          db,
          row.notification_id,
          row.merchant_address,
          row.event_type as NotificationType,
        );
        results.push({ notificationId: row.notification_id, ok: true });
      } catch (err) {
        console.error(
          `[cron] delivery failed for ${row.notification_id}: ${err instanceof Error ? err.message : err}`,
        );
        results.push({ notificationId: row.notification_id, ok: false });
      }
    }

    return NextResponse.json({
      recovered: results.filter((r) => r.ok).length,
      total: results.length,
      message: "retry processing complete",
    });
  } catch (err) {
    console.error("[cron] unexpected error occurred during retry processing");
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return runRetry(request);
}

export async function POST(request: NextRequest) {
  return runRetry(request);
}
