
-- ============================================================
-- PayProof: Remove Obsolete Payment Status Constraint
-- ============================================================
-- The newer payment_requests_status_check constraint already
-- allows pending, paid, expired, cancelled, and failed.
--
-- The older payment_requests_valid_status constraint conflicts
-- with it by excluding failed.
-- ============================================================

ALTER TABLE public.payment_requests
DROP CONSTRAINT IF EXISTS payment_requests_valid_status;
