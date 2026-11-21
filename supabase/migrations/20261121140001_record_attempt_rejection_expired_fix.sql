
-- ============================================================
-- PayProof: record_attempt_rejection Status Guard
-- Migration: 20261121150000_record_attempt_rejection_status_guard
-- Purpose:
--   1. Only record rejections while the request is pending.
--   2. Prevent a rejection from overwriting paid, expired,
--      cancelled, or failed payment requests.
--   3. Return the latest request status in the RPC response.
-- ============================================================

CREATE OR REPLACE FUNCTION public.record_attempt_rejection(
  p_reference TEXT,
  p_attempt_hash TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_request public.payment_requests%ROWTYPE;
  v_attempt public.payment_request_attempts%ROWTYPE;
  v_new_rejection_count INTEGER;
  v_current_status TEXT;
BEGIN
  -- Validate attempt hash format
  IF p_attempt_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN jsonb_build_error_message('Invalid attempt hash format.');
  END IF;

  -- Lock payment request first.
  -- Lock order must remain request -> attempt.
  SELECT * INTO v_request
  FROM public.payment_requests
  WHERE reference = p_reference
  FOR UPDATE;

  -- Verify request exists
  IF v_request IS NULL THEN
    RETURN jsonb_build_error_message('Payment request not found.');
  END IF;

  -- Only pending requests may record wallet rejections.
  -- This prevents overwriting paid, expired, cancelled, or failed.
  IF v_request.status IS DISTINCT FROM 'pending' THEN
    RETURN jsonb_build_error_message(
      'Payment request is no longer pending.'
    );
  END IF;

  -- Find and lock the corresponding attempt
  SELECT * INTO v_attempt
  FROM public.payment_request_attempts
  WHERE payment_request_id = v_request.id
    AND attempt_hash = p_attempt_hash
  FOR UPDATE;

  -- Verify attempt exists
  IF v_attempt IS NULL THEN
    RETURN jsonb_build_error_message(
      'Attempt not found for this payment request.'
    );
  END IF;

  -- Reject already-consumed attempts
  IF v_attempt.consumed_at IS NOT NULL THEN
    RETURN jsonb_build_error_message(
      'Attempt has already been consumed.'
    );
  END IF;

  -- Reject invalidated attempts
  IF v_attempt.invalidated_at IS NOT NULL THEN
    RETURN jsonb_build_error_message(
      'Attempt has been invalidated and cannot be recorded as rejected.'
    );
  END IF;

  -- Reject expired attempts
  IF v_attempt.expires_at <= NOW() THEN
    RETURN jsonb_build_error_message(
      'Attempt has expired and cannot be recorded as rejected.'
    );
  END IF;

  -- Only pending attempts may be consumed as rejected
  IF v_attempt.result IS DISTINCT FROM 'pending' THEN
    RETURN jsonb_build_error_message(
      'Attempt is not in a pending state.'
    );
  END IF;

  -- Consume the attempt exactly once
  UPDATE public.payment_request_attempts
  SET consumed_at = NOW(),
      result = 'rejected'
  WHERE id = v_attempt.id
  RETURNING * INTO v_attempt;

  -- Increment rejection count atomically
  UPDATE public.payment_requests
  SET rejection_count = rejection_count + 1
  WHERE id = v_request.id
  RETURNING rejection_count INTO v_new_rejection_count;

  -- Mark request failed after three recorded rejections
  IF v_new_rejection_count >= 3 THEN
    UPDATE public.payment_requests
    SET status = 'failed'
    WHERE id = v_request.id
      AND status = 'pending';
  END IF;

  -- Read the latest status after all updates
  SELECT status INTO v_current_status
  FROM public.payment_requests
  WHERE id = v_request.id;

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
      'status', v_current_status,
      'rejection_count', v_new_rejection_count,
      'expired', to_jsonb(v_current_status = 'expired'),
      'transaction_signature', v_request.transaction_signature,
      'payer_address', v_request.payer_address,
      'verified_at', v_request.verified_at,
      'created_at', v_request.created_at
    ),
    'rejection_count', v_new_rejection_count
  );
END;
$$;

-- Preserve service-role-only execution
REVOKE ALL ON FUNCTION public.record_attempt_rejection(TEXT, TEXT)
FROM PUBLIC;

REVOKE ALL ON FUNCTION public.record_attempt_rejection(TEXT, TEXT)
FROM anon;

REVOKE ALL ON FUNCTION public.record_attempt_rejection(TEXT, TEXT)
FROM authenticated;

GRANT EXECUTE ON FUNCTION public.record_attempt_rejection(TEXT, TEXT)
TO service_role;
