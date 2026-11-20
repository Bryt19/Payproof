-- PayProof: per-merchant notification preferences (wallet-scoped).
-- Controls which event types generate Telegram delivery for each merchant.
-- Applied manually in the Supabase SQL editor, or with `supabase db push`.

create table if not exists notification_preferences (
  id uuid primary key default gen_random_uuid(),
  merchant_address text not null,
  event_type text not null
    check (event_type in (
      'payment_request_created',
      'payment_received',
      'payment_request_expired',
      'payment_request_cancelled'
    )),
  enabled boolean not null default false,
  constraint notification_preferences_merchant_event_unique
    unique (merchant_address, event_type)
);

comment on table notification_preferences is
  'Per-merchant notification preferences: which event types generate Telegram delivery.';

comment on column notification_preferences.merchant_address is
  'Solana wallet address of the merchant.';

comment on column notification_preferences.event_type is
  'One of: payment_request_created, payment_received, payment_request_expired, payment_request_cancelled.';

comment on column notification_preferences.enabled is
  'When true, Telegram messages are sent for this event type for this merchant.';
