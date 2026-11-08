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
