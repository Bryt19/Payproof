-- PayProof: Atomic Telegram link token generation
-- Stage 4.3B Step 1: Corrected implementation
--
-- RPC signature: public.atomic_generate_telegram_link_token(p_merchant_wallet_address TEXT, p_token_hash TEXT)
--
-- Safety contract:
--   * SECURITY DEFINER with service-role-only execution
--   * Restrictive search path: pg_catalog, public, pg_temp
--   * Schema-qualified built-in functions
--   * Input validation: merchant wallet address and token hash
--   * Transaction-level advisory lock for per-merchant serialization
--   * No raw token generation, storage, or return in SQL
--   * No deep link construction in SQL
--   * No resetting revoked tokens to NULL
--   * No hiding database errors as normal statuses
--   * Proper exception handling: only unique_violation is caught
--   * Idempotent on re-run (CREATE OR REPLACE)
--   * Existing tables and data never touched outside intended UPDATE/INSERT
--
-- DO NOT execute on production without approval.
-- DO NOT run `supabase db push`.
--
-- Schema assumptions (verified against migration 20261117090000_telegram_link_redemption.sql):
--   telegram_link_tokens columns: id uuid, merchant_wallet_address text NOT NULL,
--     token_hash text NOT NULL, expires_at timestamptz NOT NULL, consumed_at timestamptz,
--     revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
--   telegram_links columns: id uuid, merchant_wallet_address text NOT NULL,
--     telegram_user_id bigint, telegram_chat_id bigint, telegram_username text,
--     linked_at timestamptz NOT NULL, unlinked_at timestamptz, created_at timestamptz
--   Partial unique index telegram_link_tokens_one_pending_per_merchant on
--     telegram_link_tokens(merchant_wallet_address) WHERE consumed_at IS NULL AND
--     revoked_at IS NULL — per production schema; not recreated here.
--   Partial unique index uq_telegram_links_active_per_merchant on
--     telegram_links(merchant_wallet_address) WHERE unlinked_at IS NULL
--   Partial unique index uq_telegram_links_active_per_user on
--     telegram_links(telegram_user_id) WHERE unlinked_at IS NULL
--
-- ---------------------------------------------------------------------------
-- 1. RPC: atomic_generate_telegram_link_token
-- ---------------------------------------------------------------------------

create or replace function public.atomic_generate_telegram_link_token(
  p_merchant_wallet_address text,
  p_token_hash              text
)
returns table (
  status           text,
  detail           text,
  expires_at       timestamptz,
  expires_in_seconds integer
)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $fn$

declare
  -- Whether an active Telegram link already exists for this merchant.
  v_has_active_link boolean;

  -- Computed expiry timestamp, calculated once and reused for INSERT and response.
  v_expires_at timestamptz;

begin

  -- -------------------------------------------------------------------
  -- 1. Input validation: merchant wallet address.
  --    Must be non-null and non-empty after trimming.
  -- -------------------------------------------------------------------
  if p_merchant_wallet_address is null
     or pg_catalog.btrim(p_merchant_wallet_address) = '' then
    return query select
      'invalid_merchant'::text                            as status,
      'Merchant wallet address is required'::text         as detail,
      null::timestamptz                                   as expires_at,
      0::integer                                          as expires_in_seconds;
    return;
  end if;

  -- -------------------------------------------------------------------
  -- 2. Input validation: token hash.
  --    Must be exactly 64 lowercase hexadecimal characters (SHA-256).
  -- -------------------------------------------------------------------
  if p_token_hash is null
     or p_token_hash !~ '^[0-9a-f]{64}$' then
    return query select
      'invalid_token_hash'::text                                              as status,
      'Token hash must be a 64-character lowercase hexadecimal string'::text  as detail,
      null::timestamptz                                                        as expires_at,
      0::integer                                                               as expires_in_seconds;
    return;
  end if;

  -- -------------------------------------------------------------------
  -- 3. Acquire a transaction-level advisory lock for per-merchant
  --    serialization. The lock is automatically released on
  --    commit or rollback; no manual release is needed.
  --    hashtextextended produces a 64-bit integer from the wallet address.
  -- -------------------------------------------------------------------
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_merchant_wallet_address, 0)
  );

  -- -------------------------------------------------------------------
  -- 4. Check for an existing active Telegram link for this merchant.
  --    "Active" means unlinked_at IS NULL.
  --    If one exists, return immediately without touching tokens.
  -- -------------------------------------------------------------------
  select exists (
    select 1
    from public.telegram_links
    where merchant_wallet_address = p_merchant_wallet_address
      and unlinked_at is null
  ) into v_has_active_link;

  if v_has_active_link then
    return query select
      'merchant_already_linked'::text                        as status,
      'Merchant already has an active Telegram link'::text   as detail,
      null::timestamptz                                      as expires_at,
      0::integer                                             as expires_in_seconds;
    return;
  end if;

  -- -------------------------------------------------------------------
  -- -------------------------------------------------------------------
  -- 5. Guard against a duplicate token hash.
  --    token_hash must be globally unique (the check constraint enforces
  --    format; a UNIQUE constraint or the TypeScript caller's SHA-256 of
  --    a fresh random token makes collisions cryptographically negligible,
  --    but we defend explicitly).
  --
  --    If the hash already exists -- whether consumed, revoked, or active --
  --    we refuse to insert a duplicate. The TypeScript route must generate
  --    a fresh token and retry.
  -- Important: A hash_conflict return must never revoke the merchant's
  --    existing pending token.
  -- -------------------------------------------------------------------
  if exists (
    select 1
    from public.telegram_link_tokens
    where token_hash = p_token_hash
  ) then
    return query select
      'hash_conflict'::text                                                      as status,
      'Token hash already exists; generate a fresh token and retry'::text        as detail,
      null::timestamptz                                                           as expires_at,
      0::integer                                                                  as expires_in_seconds;
    return;
  end if.;
  -- -------------------------------------------------------------------
  -- 6. Revoke every previous unconsumed, unrevoked token for this merchant,
  --    including expired tokens.
  --
  --    The partial unique index telegram_link_tokens_one_pending_per_merchant
  --    covers only tokens where consumed_at IS NULL AND revoked_at IS NULL,
  --    so it does not block this UPDATE from touching expired tokens.
  --
  --    We do NOT modify consumed tokens (consumed_at IS NOT NULL).
  --    We do NOT un-revoke already-revoked tokens.
  -- -------------------------------------------------------------------
  update public.telegram_link_tokens
  set    revoked_at = pg_catalog.clock_timestamp()
  where  merchant_wallet_address = p_merchant_wallet_address
    and  consumed_at is null
    and  revoked_at  is null;

  -- -------------------------------------------------------------------
  -- 6. Guard against a duplicate token hash.
  --    token_hash must be globally unique (the check constraint enforces
  --    format; a UNIQUE constraint or the TypeScript caller's SHA-256 of
  --    a fresh random token makes collisions cryptographically negligible,
  --    but we defend explicitly).
  --
  --    If the hash already exists — whether consumed, revoked, or active —
  --    we refuse to insert a duplicate. The TypeScript route must generate
  --    a fresh token and retry.
  -- -------------------------------------------------------------------
  if exists (
    select 1
    from public.telegram_link_tokens
    where token_hash = p_token_hash
  ) then
    return query select
      'hash_conflict'::text                                                      as status,
      'Token hash already exists; generate a fresh token and retry'::text        as detail,
      null::timestamptz                                                           as expires_at,
      0::integer                                                                  as expires_in_seconds;
    return;
  end if;

  -- -------------------------------------------------------------------
  -- 7. Calculate the expiry timestamp exactly once.
  --    The same value is used for the INSERT and for the response, so the
  --    caller receives the precise timestamp that was written to the database.
  -- -------------------------------------------------------------------
  v_expires_at := pg_catalog.clock_timestamp() + INTERVAL '15 minutes';

  -- -------------------------------------------------------------------
  -- 8. Insert the new token hash.
  --    The raw token (randomBytes(32) → base64url) is generated and kept
  --    exclusively in the TypeScript route. Only its SHA-256 hash is stored.
  -- -------------------------------------------------------------------
  insert into public.telegram_link_tokens (
    id,
    merchant_wallet_address,
    token_hash,
    expires_at,
    consumed_at,
    revoked_at
  )
  values (
    pg_catalog.gen_random_uuid(),
    p_merchant_wallet_address,
    p_token_hash,
    v_expires_at,
    null,
    null
  );

  -- -------------------------------------------------------------------
  -- 9. Return success with the computed expiry information.
  --    expires_in_seconds is derived from the same v_expires_at so the
  --    value is consistent with what was inserted.
  -- -------------------------------------------------------------------
  return query select
    'success'::text                                                 as status,
    'Token generated successfully'::text                           as detail,
    v_expires_at                                                   as expires_at,
    GREATEST(
    0,
    pg_catalog.ceil(
        EXTRACT(
            EPOCH FROM (
                v_expires_at - pg_catalog.clock_timestamp()
            )
        )
    )
)::INTEGER AS expires_in_seconds;
  return;

exception
  -- -------------------------------------------------------------------
  -- unique_violation: a concurrent transaction inserted a token with the
  -- same hash or violated the per-merchant active-token uniqueness index
  -- between our check and our INSERT. All changes in this transaction
  -- (the UPDATE in step 5 and the failed INSERT) are rolled back
  -- automatically by PostgreSQL before this handler runs.
  -- The TypeScript route should generate a fresh token and retry.
  -- -------------------------------------------------------------------
  when unique_violation then
    return query select
      'conflict'::text                                                      as status,
      'Concurrent token generation conflict; generate a fresh token and retry'::text as detail,
      null::timestamptz                                                      as expires_at,
      0::integer                                                             as expires_in_seconds;

  -- All other exceptions propagate uncaught so the TypeScript route
  -- receives a real error and can handle or log it appropriately.
  -- Do NOT add WHEN OTHERS here.

end;

$fn$;

-- ---------------------------------------------------------------------------
-- 2. Function access control: service_role only
--
-- Use the full function signature (text, text) so PostgreSQL can resolve the
-- overload unambiguously. This matches the CREATE OR REPLACE signature above.
-- ---------------------------------------------------------------------------

-- Revoke execution from every default role.
revoke execute
  on function public.atomic_generate_telegram_link_token(text, text)
  from public;

revoke execute
  on function public.atomic_generate_telegram_link_token(text, text)
  from anon;

revoke execute
  on function public.atomic_generate_telegram_link_token(text, text)
  from authenticated;

-- Grant execution to service_role only.
-- The Supabase service-role client (using the SERVICE_ROLE_KEY) has this role
-- and is the only caller permitted to invoke this RPC from the TypeScript route.
grant execute
  on function public.atomic_generate_telegram_link_token(text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- 3. Comment
-- ---------------------------------------------------------------------------

comment on function public.atomic_generate_telegram_link_token(text, text)
  is 'Atomic Telegram link token generation for PayProof.
Stage 4.3B Step 1 — corrected implementation.
Validates inputs, acquires per-merchant advisory lock, checks for active link,
revokes prior unconsumed tokens, guards against duplicate hash, inserts token
hash with 15-minute expiry, returns status/detail/expires_at/expires_in_seconds.
Raw token and Telegram deep link are handled exclusively in TypeScript.
Only unique_violation is caught; all other errors propagate.
Service-role only. Idempotent on re-run.';
