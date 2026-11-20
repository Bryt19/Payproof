-- PayProof: Claim and lease tracking for durable Telegram retry workers
-- Adds claim_id and lease_expires_at to notification_deliveries so that
-- concurrent workers can atomically claim deliveries and recover after lease expiry.
-- The migration is security-invoker so it respects RLS; the application code
-- uses conditional updates to ensure only one worker "wins" each claim.

-- Add claim tracking columns (added after initial table creation)
alter table notification_deliveries
  add column claim_id uuid;

alter table notification_deliveries
  add column lease_expires_at timestamptz;

-- Comment to explain the purpose
comment on column notification_deliveries.claim_id is
  'UUID identifying which worker process currently holds the claim for this delivery. Null when unclaimed or expired.';

comment on column notification_deliveries.lease_expires_at is
  'Timestamp after which this claim is considered expired and another worker may reclaim the delivery. Null when unclaimed.';
