-- ============================================================
-- PayProof: Attempt Issuance Count Correction
-- Migration: 20261121140000_attempt_issuance_count_correction
-- Applied: after 20261120100000_payment_attempt_rpc_functions
-- ============================================================
--
-- Fix: record_attempt_issuance now counts only outstanding,
-- unconsumed, non-invalidated, non-expired attempts
-- (consumed_at IS NULL AND invalidated_at IS NULL AND
-- result = 'pending' AND expires_at > NOW()).
-- Previous versions counted ALL attempts in the 24-hour window,
-- including expired and abandoned attempts, which incorrectly
-- blocked customers after wallet cancellations.
-- ============================================================

-- ------------------------------------------------------------
-- Function 1: record_attempt_issuance (corrected count query)
-- ------------------------------------------------------------
--
-- The only change is in the 24-hour attempt count: instead of
-- counting ALL issued attempts, we count only those that are
-- still outstanding — not consumed, not invalidated, still pending,
-- and not yet expired. This prevents the limit from being exhausted
-- by expired/wallet-cancelled attempts while preserving the 5-attempt
-- abuse-prevention window for truly pending attempts.
--
-- All other logic, response contract, error handling, security,
-- and RPC structure are identical to the original migration.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.record_attempt_issuance(
  p_reference TEXT,
  p_attempt_hash TEXT,
  p_expires_at TIMESTAMPTZ,
  p_ip_address INET,
  p_wallet_address TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SET search_path = public
AS $$
DECLARE
  v_request public.payment_requests%ROWTYPE;
  v_attempt_count INTEGER;
  v_attempt public.payment_request_attempts%ROWTYPE;
  v_result JSONB;
BEGIN
  -- Validate attempt hash format (64-char lowercase hex)
  IF p_attempt_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN jsonb_build_error_message('Invalid attempt hash format. Must be a 64-character lowercase hexadecimal string.');
  END IF;

  -- Validate expiry is in the future
  IF p_expires_at <= NOW() THEN
    RETURN jsonb_build_error_message('Attempt expiry must be in the future.');
  END IF;

  -- Lock the payment request row for update to prevent concurrent races
  SELECT * INTO v_request
  FROM public.payment_requests
  WHERE reference = p_reference
  FOR UPDATE;

  -- Verify request exists and is still pending
  IF v_request IS NULL THEN
    RETURN jsonb_build_error_message('Payment request not found.');
  END IF;

  IF v_request.status != 'pending' THEN
    RETURN jsonb_build_error_message('Cannot issue attempt: payment request is not in pending status (current status: %)', v_request.status);
  END IF;

  -- Enforce 5 attempts per 24-hour rolling window.
  -- Count ONLY outstanding unconsumed attempts (not consumed, not invalidated,
  -- still pending, not yet expired). Expired or consumed attempts do not block.
  SELECT COUNT(*) INTO v_attempt_count
  FROM public.payment_request_attempts
  WHERE payment_request_id = v_request.id
    AND consumed_at IS NULL
    AND invalidated_at IS NULL
    AND result = 'pending'
    AND expires_at > NOW()
    AND issued_at >= NOW() - INTERVAL '24 hours';

  IF v_attempt_count >= 5 THEN
    RETURN jsonb_build_error_message('Attempt limit exceeded: maximum 5 attempts per 24 hours per payment request.');
  END IF;

  -- Insert the new attempt record
  INSERT INTO public.payment_request_attempts (
    payment_request_id,
    attempt_hash,
    issued_at,
    expires_at,
    result,
    ip_address,
    wallet_address
  ) VALUES (
    v_request.id,
    p_attempt_hash,
    NOW(),
    p_expires_at,
    'pending',
    p_ip_address,
    p_wallet_address
  ) RETURNING * INTO v_attempt;

  RETURN jsonb_build_object(
    'success', true,
    'attempt', jsonb_build_object(
      'id', v_attempt.id,
      'payment_request_id', v_attempt.payment_request_id,
      'attempt_hash', v_attempt.attempt_hash,
      'issued_at', v_attempt.issued_at,
      'expires_at', v_attempt.expires_at,
      'consumed_at', v_attempt.consumed_at,
      'invalidated_at', v_attempt.invalidated_at,
      'result', v_attempt.result,
      'ip_address', v_attempt.ip_address,
      'wallet_address', v_attempt.wallet_address
    ),
    'rejection_count', v_request.rejection_count,
    'status', v_request.status
  );
END
$$;

-- ------------------------------------------------------------
-- Security: Revoke public access to the updated function
-- ------------------------------------------------------------

REVOKE ALL ON FUNCTION public.record_attempt_issuance FROM public;
REVOKE ALL ON FUNCTION public.record_attempt_issuance FROM anon;
REVOKE ALL ON FUNCTION public.record_attempt_issuance FROM authenticated;

-- Grant execution only to service_role
GRANT EXECUTE ON FUNCTION public.record_attempt_issuance TO service_role;