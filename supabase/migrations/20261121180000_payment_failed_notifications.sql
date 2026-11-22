-- PayProof: failed-payment notifications
-- Migration: 20261121180000_payment_failed_notifications
--
-- Purpose:
--   1. Allow the `payment_failed` event in in-app notifications, preferences
--      and Telegram delivery tracking.
--   2. Guarantee at most one failed-payment notification per payment request,
--      so a retried or duplicated rejection callback cannot send twice.
--
-- No existing preference values are changed. The application treats a missing
-- `payment_failed` preference row as enabled (matching the web Settings
-- default) and a missing row for the other events as disabled.
--
-- Applied manually in the Supabase SQL editor, or with `supabase db push`.

-- ---------------------------------------------------------------------------
-- 1. notifications.type
-- ---------------------------------------------------------------------------

alter table notifications
  drop constraint if exists notifications_type_check;

alter table notifications
  add constraint notifications_type_check
  check (type in (
    'payment_request_created',
    'payment_received',
    'payment_failed',
    'payment_request_expired',
    'payment_request_cancelled'
  ));

-- One failure notification per request. `insertNotification` treats the
-- resulting 23505 as "duplicate" and reuses the existing row.
create unique index if not exists notifications_unique_payment_failed
  on notifications (payment_request_id, type)
  where type = 'payment_failed'
    and payment_request_id is not null;

-- ---------------------------------------------------------------------------
-- 2. notification_preferences.event_type
-- ---------------------------------------------------------------------------

alter table notification_preferences
  drop constraint if exists notification_preferences_event_type_check;

alter table notification_preferences
  add constraint notification_preferences_event_type_check
  check (event_type in (
    'payment_request_created',
    'payment_received',
    'payment_failed',
    'payment_request_expired',
    'payment_request_cancelled'
  ));

-- ---------------------------------------------------------------------------
-- 3. notification_deliveries.event_type
-- ---------------------------------------------------------------------------

alter table notification_deliveries
  drop constraint if exists notification_deliveries_event_type_check;

alter table notification_deliveries
  add constraint notification_deliveries_event_type_check
  check (event_type in (
    'payment_request_created',
    'payment_received',
    'payment_failed',
    'payment_request_expired',
    'payment_request_cancelled'
  ));
