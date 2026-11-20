-- PayProof: make `notification_id` the idempotency key for Telegram delivery.
--
-- Why this is required
-- --------------------
-- `20261119140000_notification_deliveries.sql` enforces
-- `unique (merchant_address, event_type, telegram_message_id)`. That constraint
-- cannot be an idempotency key for delivery for two reasons:
--
--   1. `telegram_message_id` is NULL until Telegram accepts a message. Postgres
--      treats NULLs as distinct, so pending/failed rows never collide and a
--      re-run would insert duplicate delivery records for the same notification.
--   2. The delivery pipeline must allow at most one logical delivery per in-app
--      notification. That key is `notification_id`, which is present from the
--      first insert.
--
-- The new constraint lets the sender claim a delivery with a single insert and
-- detect concurrent claims through a 23505 unique violation.
--
-- The previous constraint is intentionally left in place: it is harmless (real
-- deliveries have unique Telegram message IDs) and this migration never rewrites
-- an already-applied migration.
--
-- NOT applied automatically. Apply manually in the Supabase SQL editor.

create unique index if not exists notification_deliveries_notification_id_key
  on notification_deliveries (notification_id);

comment on index notification_deliveries_notification_id_key is
  'Idempotency key for Telegram delivery: at most one delivery row per in-app notification.';

-- Supports "find the delivery for this notification" lookups used by the claim
-- and outcome-recording paths.
create index if not exists idx_notification_deliveries_notification
  on notification_deliveries (notification_id, status);
