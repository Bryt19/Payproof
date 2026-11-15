-- PayProof: in-app merchant notifications (wallet-scoped).
--
-- Merchant identity follows the existing model: `merchant_address` is the
-- connected wallet address recorded on payment requests. There is no separate
-- authenticated merchant/user table, so access control is scoped by
-- merchant_address and enforced by server-side service-role queries. A client
-- using the publishable key only receives rows permitted by RLS policies.
--
-- Apply manually in the Supabase SQL editor (or with `supabase db push` if the
-- project is linked) before deploying notification UI/API changes.

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

-- Prevent duplicate "request created" notifications for the same request.
create unique index if not exists notifications_unique_request_created
  on notifications (payment_request_id, type)
  where type = 'payment_request_created' and payment_request_id is not null;

-- Prevent duplicate "payment received" notifications for the same verified
-- transaction (also protects idempotent/retried verification requests).
create unique index if not exists notifications_unique_payment_received
  on notifications (payment_request_id, type, transaction_signature)
  where type = 'payment_received'
    and payment_request_id is not null
    and transaction_signature is not null;

-- Prevent duplicate expired/cancelled notifications per request when such
-- lifecycle events are emitted.
create unique index if not exists notifications_unique_request_status_event
  on notifications (payment_request_id, type)
  where type in ('payment_request_expired', 'payment_request_cancelled')
    and payment_request_id is not null;

alter table notifications enable row level security;

-- RLS: merchants may read/update only their own wallet-scoped notifications
-- when using a non-service-role key. Server-side service-role operations bypass
-- RLS, so API routes must always scope queries by merchant_address.
create policy "merchant can read own notifications"
  on notifications for select
  using (merchant_address = coalesce(current_setting('request.jwt.claims', true)::json ->> 'wallet_address', ''));

create policy "merchant can update own notifications"
  on notifications for update
  using (merchant_address = coalesce(current_setting('request.jwt.claims', true)::json ->> 'wallet_address', ''))
  with check (merchant_address = coalesce(current_setting('request.jwt.claims', true)::json ->> 'wallet_address', ''));

-- No public/client inserts; notifications are created only by trusted server code.
create policy "no public notification inserts"
  on notifications for insert
  with check (false);

create policy "no public notification deletes"
  on notifications for delete
  using (false);
