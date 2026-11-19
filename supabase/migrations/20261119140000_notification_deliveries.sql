-- PayProof: Telegram delivery tracking (wallet-scoped).
-- Tracks the outcome of each Telegram notification send attempt.
-- Applied manually in the Supabase SQL editor, or with `supabase db push`.

create table if not exists notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references notifications(id) on delete cascade,
  merchant_address text not null,
  event_type text not null
    check (event_type in (
      'payment_request_created',
      'payment_received',
      'payment_request_expired',
      'payment_request_cancelled'
    )),
  status text not null
    check (status in ('pending', 'delivered', 'failed')),
  telegram_message_id text,
  attempt integer not null default 1,
  max_attempts integer not null default 3,
  sent_at timestamptz,
  delivered_at timestamptz,
  error_message text,
  created_at timestamptz not null default now(),
  constraint notification_deliveries_merchant_event_unique
    unique (merchant_address, event_type, telegram_message_id)
);

comment on table notification_deliveries is
  'Per-delivery tracking for Telegram notifications: state, attempts, message IDs.';

comment on column notification_deliveries.notification_id is
  'FK to the in-app notification record that triggered this delivery.';

comment on column notification_deliveries.merchant_address is
  'Solana wallet address of the merchant.';

comment on column notification_deliveries.event_type is
  'One of: payment_request_created, payment_received, payment_request_expired, payment_request_cancelled.';

comment on column notification_deliveries.status is
  'Current delivery state: pending, delivered, or failed.';

comment on column notification_deliveries.telegram_message_id is
  'Telegram message_id returned by the Bot API on successful send; used for '
  'dedup and retry targeting.';

comment on column notification_deliveries.attempt is
  'Current retry attempt number (1-based).';

comment on column notification_deliveries.max_attempts is
  'Maximum number of retry attempts for temporary failures.';

comment on column notification_deliveries.sent_at is
  'When the Telegram API was last called for this delivery.';

comment on column notification_deliveries.delivered_at is
  'When the delivery was confirmed as delivered (Telegram API success).';

comment on column notification_deliveries.error_message is
  'Last error message from the Telegram API, if the status is failed.';

-- Index for merchant-scoped queries (notifications per merchant).
create index if not exists idx_notification_deliveries_merchant
  on notification_deliveries (merchant_address, created_at desc);

-- Index for per-event-type queries.
create index if not exists idx_notification_deliveries_event
  on notification_deliveries (event_type, status, created_at desc);

