-- PayProof Task 09: persist independently verified payments.
--
-- This migration is non-destructive:
--   * it only adds nullable columns,
--   * widens the status check to the lifecycle already described by the app,
--   * adds a partial unique index so one transaction cannot pay two requests.
--
-- Existing rows are left untouched. Apply it manually in the Supabase SQL
-- editor (or with `supabase db push` if the project is linked) before deploying
-- Task 09. Row Level Security is not changed: the verifier writes with the
-- server-only service-role key, and no public write policy is added.

alter table payment_requests
  add column if not exists transaction_signature text,
  add column if not exists payer_address text,
  add column if not exists verified_at timestamptz;

-- The old constraint only allowed 'pending'. Replace it without touching rows.
alter table payment_requests
  drop constraint if exists payment_requests_status_check;

alter table payment_requests
  add constraint payment_requests_status_check
  check (status in ('pending', 'paid', 'expired', 'cancelled'));

-- A transaction signature may pay at most one request. Multiple NULLs are
-- allowed, so pending/expired/cancelled rows are unaffected.
create unique index if not exists payment_requests_transaction_signature_key
  on payment_requests (transaction_signature)
  where transaction_signature is not null;

-- A row can only be paid with the full evidence written by the verifier.
alter table payment_requests
  drop constraint if exists payment_requests_paid_requires_verification;

alter table payment_requests
  add constraint payment_requests_paid_requires_verification
  check (
    status <> 'paid'
    or (
      transaction_signature is not null
      and payer_address is not null
      and verified_at is not null
    )
  );

comment on column payment_requests.transaction_signature is
  'Devnet transaction signature written only by the server-side verifier.';
comment on column payment_requests.payer_address is
  'Wallet that signed the verified transaction (the customer, not the merchant).';
comment on column payment_requests.verified_at is
  'When the server independently verified the transaction at confirmed commitment.';
