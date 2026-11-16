-- PayProof: merchant auth challenges and sessions for wallet-signature login.
--
-- Supersedes 20261114090000_merchant_auth.sql, which could never have been
-- applied: one partial index used the non-immutable `now()` in its predicate
-- and another CREATE INDEX statement was syntactically invalid. That file has
-- been replaced by this one; no data is lost because the table was never
-- populated by a successful migration.
--
-- Column names, types and usage are derived from
-- src/lib/auth/merchant-auth-service.ts:
--
--   createChallenge    insert(challenge_nonce, domain, issued_at, expires_at,
--                             wallet_address)
--   consumeChallenge   select(eq challenge_nonce, is session_token null,
--                             is deleted_at null, gte expires_at)
--                      update(eq id, is session_token null, is deleted_at null)
--                             -> session_token, session_expires_at
--   validateSession    select(eq session_token, is deleted_at null)
--   invalidateSession  update(eq session_token, is deleted_at null)
--                             -> deleted_at
--
-- The service stores SHA-256(session token) hex in `session_token`; the raw
-- token only ever lives in the HttpOnly cookie. The check constraint below
-- enforces that shape at the database level.
--
-- Non-destructive and idempotent: only creates a new table plus its indexes,
-- constraints and RLS. Apply manually in the Supabase SQL editor, or with
-- `supabase db push` when the project is linked.

create table if not exists merchant_auth (
  id                    uuid primary key default gen_random_uuid(),

  -- Challenge, written by createChallenge().
  challenge_nonce       text not null,        -- 32 random bytes, base64url, generated server-side
  domain                text not null,        -- NEXT_PUBLIC_WALLET_SIGN_DOMAIN bound at issue time
  issued_at             timestamptz not null default now(),
  expires_at            timestamptz not null, -- issued_at + 5 minutes

  -- Session, written atomically when a challenge is redeemed.
  session_token         text,                 -- sha256 hex of the cookie token, never the token itself
  session_expires_at    timestamptz,          -- session issue time + 15 minutes

  -- Wallet that requested the challenge; also the session owner.
  wallet_address        text not null,

  -- Lifecycle.
  created_at            timestamptz not null default now(),
  deleted_at            timestamptz,          -- logout / revocation marker

  constraint merchant_auth_challenge_nonce_key unique (challenge_nonce),
  constraint merchant_auth_session_token_key unique (session_token),

  -- A challenge may not expire before it is issued.
  constraint merchant_auth_expiry_after_issue
    check (expires_at > issued_at),

  -- Only a SHA-256 hex digest is ever persisted as a session token.
  constraint merchant_auth_session_token_is_sha256_hex
    check (session_token is null or session_token ~ '^[0-9a-f]{64}$'),

  -- A session always carries its own expiry.
  constraint merchant_auth_session_requires_expiry
    check (session_token is null or session_expires_at is not null),

  -- Addresses are stored exactly as the service trims them.
  constraint merchant_auth_wallet_address_trimmed
    check (wallet_address = btrim(wallet_address) and length(wallet_address) > 0),

  -- Nonce and domain are never blank.
  constraint merchant_auth_challenge_fields_present
    check (length(challenge_nonce) > 0 and length(domain) > 0)
);

-- Remove the two partial indexes drafted by the superseded migration. The
-- first used a non-immutable now() predicate (rejected at CREATE INDEX time);
-- the second was never created because its statement did not parse.
drop index if exists idx_merchant_auth_active_sessions_by_wallet;
drop index if exists idx_merchant_auth_session_lookup;

-- Challenge lookups are equality on the unique `challenge_nonce` index above.
-- This partial index serves the cleanup sweep for abandoned challenges.
create index if not exists merchant_auth_open_challenges_expires_at
  on merchant_auth (expires_at)
  where session_token is null
    and deleted_at is null;

-- Session validation is equality on the unique `session_token` index above.
-- This partial index serves pruning of expired sessions.
create index if not exists merchant_auth_active_sessions_expires_at
  on merchant_auth (session_expires_at)
  where session_token is not null
    and deleted_at is null;

-- Wallet-scoped session listing (support tooling, future "active sessions" UI).
create index if not exists merchant_auth_wallet_sessions
  on merchant_auth (wallet_address, session_expires_at desc)
  where session_token is not null
    and deleted_at is null;

-- Add the check constraints that a partially applied older migration could be
-- missing (the table above already defines them for fresh databases).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'merchant_auth'::regclass
      and conname = 'merchant_auth_expiry_after_issue'
  ) then
    alter table merchant_auth
      add constraint merchant_auth_expiry_after_issue
      check (expires_at > issued_at);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'merchant_auth'::regclass
      and conname = 'merchant_auth_session_token_is_sha256_hex'
  ) then
    alter table merchant_auth
      add constraint merchant_auth_session_token_is_sha256_hex
      check (session_token is null or session_token ~ '^[0-9a-f]{64}$');
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'merchant_auth'::regclass
      and conname = 'merchant_auth_session_requires_expiry'
  ) then
    alter table merchant_auth
      add constraint merchant_auth_session_requires_expiry
      check (session_token is null or session_expires_at is not null);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'merchant_auth'::regclass
      and conname = 'merchant_auth_wallet_address_trimmed'
  ) then
    alter table merchant_auth
      add constraint merchant_auth_wallet_address_trimmed
      check (wallet_address = btrim(wallet_address) and length(wallet_address) > 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'merchant_auth'::regclass
      and conname = 'merchant_auth_challenge_fields_present'
  ) then
    alter table merchant_auth
      add constraint merchant_auth_challenge_fields_present
      check (length(challenge_nonce) > 0 and length(domain) > 0);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Access control
-- ---------------------------------------------------------------------------
-- Authentication records must never be reachable from the browser, even with
-- a publishable anon key. RLS is enabled with no permissive policy, so anon
-- and authenticated roles read and write nothing; the server-side service-role
-- client bypasses RLS and remains the only access path. The jwt-claim-based
-- policies used for notifications deliberately do not apply here: wallet
-- ownership is proven by this table, so it cannot be used to prove itself.

alter table merchant_auth enable row level security;

revoke all on table merchant_auth from anon, authenticated;

drop policy if exists "no client access to auth records" on merchant_auth;

create policy "no client access to auth records"
  on merchant_auth for all
  to anon, authenticated
  using (false)
  with check (false);

comment on table merchant_auth is
  'Short-lived merchant auth challenges and the sessions they produce. Server-only (service-role) access.';
comment on column merchant_auth.challenge_nonce is
  'Server-generated single-use nonce embedded in the signed message.';
comment on column merchant_auth.domain is
  'Application origin the challenge was issued for; must match on redemption.';
comment on column merchant_auth.wallet_address is
  'Base58 Solana address that requested the challenge and owns the session.';
comment on column merchant_auth.session_token is
  'SHA-256 hex digest of the session token. The raw token exists only in the HttpOnly cookie.';
comment on column merchant_auth.session_expires_at is
  'Session expiry; validation rejects rows past this timestamp.';
comment on column merchant_auth.deleted_at is
  'Set on logout. Deleted rows are excluded from every service query.';
