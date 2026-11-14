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
    check (status in ('pending', 'paid', 'expired', 'cancelled')),
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
