BEGIN;

-- Allow uncertain as a valid delivery status
ALTER TABLE public.notification_deliveries
DROP CONSTRAINT notification_deliveries_status_check;

ALTER TABLE public.notification_deliveries
ADD CONSTRAINT notification_deliveries_status_check
CHECK (
  status IN ('pending', 'delivered', 'failed', 'uncertain')
);

-- Correct existing records that represent uncertain deliveries
UPDATE public.notification_deliveries
SET status = 'uncertain'
WHERE status = 'failed'
  AND error_message IS NOT NULL
  AND error_message LIKE '%delivery uncertain%';

COMMIT;