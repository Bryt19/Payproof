-- ============================================================
-- PayProof: Payment Attempt Tracking Migration
-- Migration: 20261120090000_payment_attempt_tracking
-- ============================================================

-- ------------------------------------------------------------
-- A. Update payment_requests
-- ------------------------------------------------------------

-- Add rejection_count column with non-negative check constraint
ALTER TABLE public.payment_requests
  ADD COLUMN rejection_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.payment_requests
  ADD CONSTRAINT payment_requests_rejection_count_non_negative
  CHECK (rejection_count >= 0);

-- Extend the status constraint to include 'failed'
-- Drop the existing constraint and add one with 'failed' added
DO $$
BEGIN
  -- Attempt to drop the existing constraint; ignore if it doesn't exist
  BEGIN
    ALTER TABLE public.payment_requests
      DROP CONSTRAINT payment_requests_status_check;
  EXCEPTION
    WHEN wrong_object_type THEN
      NULL; -- constraint may not exist in some edge cases
    WHEN others THEN
      NULL;
  END;

  -- Add the extended constraint with 'failed'
  ALTER TABLE public.payment_requests
    ADD CONSTRAINT payment_requests_status_check
    CHECK (status IN ('pending', 'paid', 'expired', 'cancelled', 'failed'));
END $$;

-- ------------------------------------------------------------
-- B. Create payment_request_attempts table
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.payment_request_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  payment_request_id TEXT NOT NULL
    REFERENCES public.payment_requests(id) ON DELETE CASCADE,

  attempt_hash TEXT NOT NULL
    CHECK (attempt_hash ~ '^[0-9a-f]{64}$'),

  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  expires_at TIMESTAMPTZ NOT NULL,

  consumed_at TIMESTAMPTZ,

  invalidated_at TIMESTAMPTZ,

  result TEXT NOT NULL
    CHECK (result IN ('pending', 'rejected')),

  ip_address INET,

  wallet_address TEXT,

  -- Constraint: invalidated attempts cannot also be consumed
  CONSTRAINT payment_request_attempts_invalidated_not_consumed
  CHECK (invalidated_at IS NULL OR consumed_at IS NULL),

  -- Constraint: expiry must occur after issuance
  CONSTRAINT payment_request_attempts_expiry_after_issue
  CHECK (expires_at > issued_at),

  -- Unique constraint: one attempt hash per payment request
  CONSTRAINT payment_request_attempts_unique_hash_per_request
  UNIQUE (payment_request_id, attempt_hash)
);

-- ------------------------------------------------------------
-- Indexes for payment_request_attempts
-- ------------------------------------------------------------

-- Looking up attempts by payment request
CREATE INDEX IF NOT EXISTS idx_payment_request_attempts_payment_request_id
  ON public.payment_request_attempts (payment_request_id);

-- Counting attempts issued within a time window
CREATE INDEX IF NOT EXISTS idx_payment_request_attempts_issued_at
  ON public.payment_request_attempts (issued_at);

-- Finding outstanding, unconsumed and non-invalidated attempts
CREATE INDEX IF NOT EXISTS idx_payment_request_attempts_outstanding
  ON public.payment_request_attempts (payment_request_id)
  WHERE consumed_at IS NULL AND invalidated_at IS NULL;

-- ------------------------------------------------------------
-- C. RLS and privileges
-- ------------------------------------------------------------

-- Enable row-level security
ALTER TABLE public.payment_request_attempts ENABLE ROW LEVEL SECURITY;

-- Revoke direct access from PUBLIC, anon, and authenticated
REVOKE ALL ON TABLE public.payment_request_attempts FROM public;
REVOKE ALL ON TABLE public.payment_request_attempts FROM anon;
REVOKE ALL ON TABLE public.payment_request_attempts FROM authenticated;

-- Grant necessary access to service_role
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.payment_request_attempts TO service_role;

-- Deny-all policy for anon and authenticated (consistent with PayProof security approach)
CREATE POLICY "no anon access to attempt records"
  ON public.payment_request_attempts FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

-- Service-role bypass policy (intentional, for server-side operations)
CREATE POLICY "service_role full access to attempt records"
  ON public.payment_request_attempts FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);