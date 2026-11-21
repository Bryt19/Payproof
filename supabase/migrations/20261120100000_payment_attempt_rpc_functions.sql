-- ============================================================
-- PayProof: Payment Attempt RPC Functions
-- Migration: 20261120100000_payment_attempt_rpc_functions
-- ============================================================

-- ------------------------------------------------------------
-- Function 1: record_attempt_issuance
-- Atomically issues a new attempt token for a payment request.
-- Enforces a 5-attempts-per-24-hours limit under row-level lock.
-- The raw token is never stored; only its SHA-256 hash is persisted.
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
  -- Count ALL issued attempts (including expired, consumed, rejected, invalidated).
  SELECT COUNT(*) INTO v_attempt_count
  FROM public.payment_request_attempts
  WHERE payment_request_id = v_request.id
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
  )
  VALUES (
    v_request.id,
    p_attempt_hash,
    NOW(),
    p_expires_at,
    'pending',
    p_ip_address,
    p_wallet_address
  )
  RETURNING * INTO v_attempt;

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
-- Function 2: record_attempt_rejection
-- Atomically records a rejection for a given attempt hash.
-- Locks the payment request row first, then the attempt row.
-- Consistent lock order (request -> attempt) prevents deadlocks.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.record_attempt_rejection(
  p_reference TEXT,
  p_attempt_hash TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SET search_path = public
AS $$
DECLARE
  v_request public.payment_requests%ROWTYPE;
  v_attempt public.payment_request_attempts%ROWTYPE;
  v_new_rejection_count INTEGER;
BEGIN
  -- Validate attempt hash format
  IF p_attempt_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN jsonb_build_error_message('Invalid attempt hash format.');
  END IF;

  -- Lock the payment request row first (consistent lock order: request -> attempt)
  SELECT * INTO v_request
  FROM public.payment_requests
  WHERE reference = p_reference
  FOR UPDATE;

  -- Verify request exists
  IF v_request IS NULL THEN
    RETURN jsonb_build_error_message('Payment request not found.');
  END IF;

  -- Find and lock the corresponding attempt
  SELECT * INTO v_attempt
  FROM public.payment_request_attempts
  WHERE payment_request_id = v_request.id
    AND attempt_hash = p_attempt_hash
  FOR UPDATE;

  -- Verify attempt exists and is valid for consumption
  IF v_attempt IS NULL THEN
    RETURN jsonb_build_error_message('Attempt not found for this payment request.');
  END IF;

  -- Reject missing/already-consumed attempts
  IF v_attempt.consumed_at IS NOT NULL THEN
    RETURN jsonb_build_error_message('Attempt has already been consumed.');
  END IF;

  -- Reject invalidated attempts
  IF v_attempt.invalidated_at IS NOT NULL THEN
    RETURN jsonb_build_error_message('Attempt has been invalidated and cannot be recorded as rejected.');
  END IF;

  -- Reject expired attempts
  IF v_attempt.expires_at < NOW() THEN
    RETURN jsonb_build_error_message('Attempt has expired and cannot be recorded as rejected.');
  END IF;

  -- Mark the attempt as consumed with result = rejected
  UPDATE public.payment_request_attempts
  SET consumed_at = NOW(),
      result = 'rejected'
  WHERE id = v_attempt.id
  RETURNING * INTO v_attempt;

  -- Increment the rejection count atomically
  UPDATE public.payment_requests
  SET rejection_count = rejection_count + 1
  WHERE id = v_request.id
  RETURNING rejection_count INTO v_new_rejection_count;

  -- Check if the request should now be marked as failed
  IF v_new_rejection_count >= 3 THEN
    UPDATE public.payment_requests
    SET status = 'failed'
    WHERE id = v_request.id;
  END IF;

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
    'payment_request', jsonb_build_object(
      'id', v_request.id,
      'reference', v_request.reference,
      'status', COALESCE(
        (SELECT status FROM public.payment_requests WHERE id = v_request.id),
        v_request.status
      ),
      'rejection_count', COALESCE(v_new_rejection_count, v_request.rejection_count),
      'expired', v_request.expired,
      'transaction_signature', v_request.transaction_signature,
      'payer_address', v_request.payer_address,
      'verified_at', v_request.verified_at,
      'created_at', v_request.created_at
    ),
    'rejection_count', v_new_rejection_count
  );
END
$$;

-- ------------------------------------------------------------
-- Security: Revoke public access to both functions
-- ------------------------------------------------------------

REVOKE ALL ON FUNCTION public.record_attempt_issuance FROM public;
REVOKE ALL ON FUNCTION public.record_attempt_issuance FROM anon;
REVOKE ALL ON FUNCTION public.record_attempt_issuance FROM authenticated;

REVOKE ALL ON FUNCTION public.record_attempt_rejection FROM public;
REVOKE ALL ON FUNCTION public.record_attempt_rejection FROM anon;
REVOKE ALL ON FUNCTION public.record_attempt_rejection FROM authenticated;

-- Grant execution only to service_role
GRANT EXECUTE ON FUNCTION public.record_attempt_issuance TO service_role;
GRANT EXECUTE ON FUNCTION public.record_attempt_rejection TO service_role;