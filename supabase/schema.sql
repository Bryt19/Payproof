-- PayProof payment requests
-- Run this in your Supabase project's SQL editor.
-- Required environment variables (server-side only, never NEXT_PUBLIC_):
--   SUPABASE_URL
--   SUPABASE_SERVICE_ROLE_KEY

create table if not exists payment_requests (
  id            text primary key,
  reference     text not null unique,
  amount_lamports text not null,
  description   text not null,
  customer_name text,
  customer_email text,
  merchant_address text,
  status        text not null default 'pending'
    check (status in ('pending', 'paid', 'expired', 'cancelled', 'failed')),
  rejection_count INTEGER NOT NULL DEFAULT 0
    CONSTRAINT payment_requests_rejection_count_non_negative
    CHECK (rejection_count >= 0),
  transaction_signature text,
  payer_address text,
  verified_at   timestamptz,
  created_at    timestamptz not null default now()
);

-- Fast lookups by the reference used in checkout links.
create index if not exists idx_payment_requests_reference
  on payment_requests (reference);

-- Keep the amount column a clean integer string.
alter table payment_requests
  add constraint amount_lamports_is_integer
  check (amount_lamports ~ '^\d+$');

alter table payment_requests
  add constraint description_not_empty
  check (length(description) >= 3);

alter table payment_requests
  add constraint customer_email_format
  check (customer_email is null
         or customer_email ~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$');

alter table payment_requests
  add constraint customer_name_length
  check (customer_name is null
         or length(customer_name) <= 80);

alter table payment_requests
  add constraint customer_email_length
  check (customer_email is null
         or length(customer_email) <= 254);

-- A transaction signature may pay at most one request.
create unique index if not exists payment_requests_transaction_signature_key
  on payment_requests (transaction_signature)
  where transaction_signature is not null;

-- Paid rows must carry the evidence written by the server-side verifier.
alter table payment_requests
  add constraint payment_requests_paid_requires_verification
  check (
    status <> 'paid'
    or (transaction_signature is not null
        and payer_address is not null
        and verified_at is not null)
  );

-- Row-level security
alter table payment_requests enable row level security;

-- Advisory policy: with the server using the service-role key, RLS is
-- bypassed intentionally. These policies document the intended least-privilege
-- surface for a future setup that uses a scoped/anonymous key instead.
create policy "checkout can read any request by reference"
  on payment_requests for select
  using (true);

create policy "no public writes"
  on payment_requests for all
  using (false);

-- ---------------------------------------------------------------------------
-- Payment attempt tracking
-- ---------------------------------------------------------------------------
-- Stores SHA-256 hashes of cryptographically random attempt tokens reported
-- by customers when a wallet rejects a payment. Three rejections mark a
-- payment request as `failed`.

create table if not exists payment_request_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_request_id TEXT NOT NULL
    REFERENCES payment_requests(id) ON DELETE CASCADE,
  attempt_hash TEXT NOT NULL
    CHECK (attempt_hash ~ '^[0-9a-f]{64}$'),
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  invalidated_at TIMESTAMPTZ,
  result TEXT NOT NULL
    CHECK (result IN ('pending', 'rejected')),
  ip_address INET,
  wallet_address TEXT,
  CONSTRAINT payment_request_attempts_invalidated_not_consumed
  CHECK (invalidated_at IS NULL OR consumed_at IS NULL),
  CONSTRAINT payment_request_attempts_expiry_after_issue
  CHECK (expires_at > issued_at),
  CONSTRAINT payment_request_attempts_unique_hash_per_request
  UNIQUE (payment_request_id, attempt_hash)
);

CREATE INDEX IF NOT EXISTS idx_payment_request_attempts_payment_request_id
  ON payment_request_attempts (payment_request_id);

CREATE INDEX IF NOT EXISTS idx_payment_request_attempts_issued_at
  ON payment_request_attempts (issued_at);

CREATE INDEX IF NOT EXISTS idx_payment_request_attempts_outstanding
  ON payment_request_attempts (payment_request_id)
  WHERE consumed_at IS NULL AND invalidated_at IS NULL;

-- ---------------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------------
-- In-app merchant notifications generated from real application events.
-- Merchant identity is the connected wallet address (`merchant_address`),
-- matching the existing payment request ownership model.

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  merchant_address text not null,
  type text not null
    check (type in (
      'payment_request_created',
      'payment_received',
      'payment_failed',
      'payment_request_expired',
      'payment_request_cancelled'
    )),
  title text not null,
  message text not null,
  payment_request_id text references payment_requests(id) on delete set null,
  payment_request_reference text not null,
  transaction_signature text,
  is_read boolean not null default false,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  constraint notifications_read_at_consistency
    check ((is_read = false and read_at is null) or (is_read = true and read_at is not null))
);

create index if not exists idx_notifications_merchant_created_at
  on notifications (merchant_address, created_at desc);

create index if not exists idx_notifications_merchant_unread
  on notifications (merchant_address, is_read, created_at desc);

create unique index if not exists notifications_unique_request_created
  on notifications (payment_request_id, type)
  where type = 'payment_request_created' and payment_request_id is not null;

create unique index if not exists notifications_unique_payment_received
  on notifications (payment_request_id, type, transaction_signature)
  where type = 'payment_received'
    and payment_request_id is not null
    and transaction_signature is not null;

create unique index if not exists notifications_unique_request_status_event
  on notifications (payment_request_id, type)
  where type in ('payment_request_expired', 'payment_request_cancelled')
    and payment_request_id is not null;

create unique index if not exists notifications_unique_payment_failed
  on notifications (payment_request_id, type)
  where type = 'payment_failed'
    and payment_request_id is not null;

alter table notifications enable row level security;

create policy "merchant can read own notifications"
  on notifications for select
  using (merchant_address = coalesce(current_setting('request.jwt.claims', true)::json ->> 'wallet_address', ''));

create policy "merchant can update own notifications"
  on notifications for update
  using (merchant_address = coalesce(current_setting('request.jwt.claims', true)::json ->> 'wallet_address', ''))
  with check (merchant_address = coalesce(current_setting('request.jwt.claims', true)::json ->> 'wallet_address', ''));

create policy "no public notification inserts"
  on notifications for insert
  with check (false);

create policy "no public notification deletes"
  on notifications for delete
  using (false);

-- ---------------------------------------------------------------------------
-- Merchant authentication
-- ---------------------------------------------------------------------------
-- ---------------------------------------------------------------------------
-- AI payment-draft authorization registry
-- ---------------------------------------------------------------------------
-- Server-only, short-lived authorizations for AI-prepared payment drafts.
-- Nonces are consumed atomically with payment-request creation by the RPCs in
-- 20261122120000_ai_payment_draft_authorizations.sql.

create table if not exists ai_payment_draft_authorizations (
  nonce                 text primary key,
  merchant_wallet       text not null,
  status                text not null default 'active'
    check (status in ('active', 'revoked', 'processing', 'consumed')),
  draft_fingerprint     text not null
    check (draft_fingerprint ~ '^[0-9a-f]{64}$'),
  expires_at            timestamptz not null,
  created_at            timestamptz not null default now(),
  consumed_at           timestamptz,
  payment_request_id    text references payment_requests(id) on delete restrict,
  processing_started_at timestamptz,
  constraint ai_draft_auth_nonce_format
    check (nonce ~ '^[a-f0-9]{32,64}$'),
  constraint ai_draft_auth_wallet_not_empty
    check (length(btrim(merchant_wallet)) > 0),
  constraint ai_draft_auth_expiry_valid
    check (expires_at > created_at),
  constraint ai_draft_auth_consumed_consistency
    check (
      (status in ('active', 'revoked')
        and consumed_at is null
        and payment_request_id is null
        and processing_started_at is null)
      or (status = 'processing'
        and consumed_at is null
        and payment_request_id is null
        and processing_started_at is not null)
      or (status = 'consumed'
        and consumed_at is not null
        and payment_request_id is not null
        and processing_started_at is null)
    )
);

create unique index if not exists ai_draft_auth_request_unique
  on ai_payment_draft_authorizations (payment_request_id)
  where payment_request_id is not null;

create index if not exists ai_draft_auth_merchant_status
  on ai_payment_draft_authorizations (merchant_wallet, status, expires_at desc);

create index if not exists ai_draft_auth_active_expiry
  on ai_payment_draft_authorizations (expires_at)
  where status = 'active';

alter table ai_payment_draft_authorizations enable row level security;

revoke all on table ai_payment_draft_authorizations from public;
revoke all on table ai_payment_draft_authorizations from anon;
revoke all on table ai_payment_draft_authorizations from authenticated;

grant select, insert, update, delete
  on table ai_payment_draft_authorizations
  to service_role;

create policy "no client access to ai draft authorizations"
  on ai_payment_draft_authorizations for all
  to anon, authenticated
  using (false)
  with check (false);

-- Short-lived wallet-signature auth challenges and the sessions they produce.
-- Mirrors supabase/migrations/20261115150000_merchant_auth_final.sql. Sessions
-- store only the SHA-256 hex digest of the cookie token, never the token itself.

create table if not exists merchant_auth (
  id                    uuid primary key default gen_random_uuid(),
  challenge_nonce       text not null,
  domain                text not null,
  issued_at             timestamptz not null default now(),
  expires_at            timestamptz not null,
  session_token         text,
  session_expires_at    timestamptz,
  wallet_address        text not null,
  created_at            timestamptz not null default now(),
  deleted_at            timestamptz,
  constraint merchant_auth_challenge_nonce_key unique (challenge_nonce),
  constraint merchant_auth_session_token_key unique (session_token),
  constraint merchant_auth_expiry_after_issue
    check (expires_at > issued_at),
  constraint merchant_auth_session_token_is_sha256_hex
    check (session_token is null or session_token ~ '^[0-9a-f]{64}$'),
  constraint merchant_auth_session_requires_expiry
    check (session_token is null or session_expires_at is not null),
  constraint merchant_auth_wallet_address_trimmed
    check (wallet_address = btrim(wallet_address) and length(wallet_address) > 0),
  constraint merchant_auth_challenge_fields_present
    check (length(challenge_nonce) > 0 and length(domain) > 0)
);

-- Cleanup sweep for abandoned challenges.
create index if not exists merchant_auth_open_challenges_expires_at
  on merchant_auth (expires_at)
  where session_token is null
    and deleted_at is null;

-- Pruning of expired sessions.
create index if not exists merchant_auth_active_sessions_expires_at
  on merchant_auth (session_expires_at)
  where session_token is not null
    and deleted_at is null;

-- Wallet-scoped session listing.
create index if not exists merchant_auth_wallet_sessions
  on merchant_auth (wallet_address, session_expires_at desc)
  where session_token is not null
    and deleted_at is null;

-- Server-only: no client policy is defined, so anon/authenticated can neither
-- read nor write auth records. The service-role key bypasses RLS.
alter table merchant_auth enable row level security;

revoke all on table merchant_auth from public;
revoke all on table merchant_auth from anon;
revoke all on table merchant_auth from authenticated;

grant select, insert, update, delete on table merchant_auth to service_role;

create policy "no client access to auth records"
  on merchant_auth for all
  to anon, authenticated
  using (false)
  with check (false);
