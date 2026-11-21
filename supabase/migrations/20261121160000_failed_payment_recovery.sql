
-- ============================================================
-- PayProof: Failed Payment Recovery
-- Migration: 20261121160000_failed_payment_recovery
--
-- Purpose:
-- 1. Allow payment attempts for pending and failed requests.
-- 2. Preserve rejection_count during recovery.
-- 3. Invalidate outstanding attempts when a request is no
--    longer pending, without incrementing rejection_count.
-- 4. Preserve service-role-only RPC execution.
--
-- Only server-side Solana transaction verification can
-- transition a failed request to paid.
-- ============================================================


-- ============================================================
-- 1. UPDATE ATTEMPT ISSUANCE
-- ============================================================

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
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_request public.payment_requests%ROWTYPE;
  v_attempt_count INTEGER;
  v_attempt public.payment_request_attempts%ROWTYPE;
BEGIN

  -- Validate attempt hash
  IF p_attempt_hash IS NULL
     OR p_attempt_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN jsonb_build_error_message(
      'Invalid attempt hash format.'
    );
  END IF;

  -- Validate expiry
  IF p_expires_at IS NULL OR p_expires_at <= NOW() THEN
    RETURN jsonb_build_error_message(
      'Attempt expiry must be in the future.'
    );
  END IF;

  -- Lock payment request
  SELECT *
  INTO v_request
  FROM public.payment_requests
  WHERE reference = p_reference
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_error_message(
      'Payment request not found.'
    );
  END IF;

  -- Pending and failed requests can receive attempts.
  -- Paid, expired and cancelled requests remain closed.
  IF v_request.status NOT IN ('pending', 'failed') THEN
    RETURN jsonb_build_error_message(
      'Cannot issue attempt: payment request is not open (current status: %)',
      v_request.status
    );
  END IF;

  -- Maximum 5 outstanding valid attempts within the
  -- rolling 24-hour window.
  SELECT COUNT(*)
  INTO v_attempt_count
  FROM public.payment_request_attempts
  WHERE payment_request_id = v_request.id
    AND consumed_at IS NULL
    AND invalidated_at IS NULL
    AND result = 'pending'
    AND expires_at > NOW()
    AND issued_at >= NOW() - INTERVAL '24 hours';

  IF v_attempt_count >= 5 THEN
    RETURN jsonb_build_error_message(
      'Attempt limit exceeded: maximum 5 outstanding attempts per 24 hours per payment request.'
    );
  END IF;

  -- Insert attempt
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

  -- Rejection count is intentionally never modified.
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

END;
$$;


-- ============================================================
-- 2. UPDATE ATTEMPT REJECTION
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

  -- Validate hash
  IF p_attempt_hash IS NULL
     OR p_attempt_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN jsonb_build_error_message(
      'Invalid attempt hash format.'
    );
  END IF;

  -- Lock request first. Maintain consistent lock order:
  -- payment request -> payment attempt.
  SELECT *
  INTO v_request
  FROM public.payment_requests
  WHERE reference = p_reference
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_error_message(
      'Payment request not found.'
    );
  END IF;

  -- Lock corresponding attempt
  SELECT *
  INTO v_attempt
  FROM public.payment_request_attempts
  WHERE payment_request_id = v_request.id
    AND attempt_hash = p_attempt_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_error_message(
      'Attempt not found for this payment request.'
    );
  END IF;

  -- If request is no longer pending, invalidate any
  -- outstanding attempt without recording another rejection.
  IF v_request.status IS DISTINCT FROM 'pending' THEN

    IF v_attempt.consumed_at IS NULL
       AND v_attempt.invalidated_at IS NULL THEN

      UPDATE public.payment_request_attempts
      SET invalidated_at = NOW()
      WHERE id = v_attempt.id
      RETURNING * INTO v_attempt;

    END IF;

    RETURN jsonb_build_object(
      'success', true,
      'recorded', false,
      'reason', 'request-not-pending',
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
        'status', v_request.status,
        'rejection_count', v_request.rejection_count,
        'expired', to_jsonb(v_request.status = 'expired'),
        'transaction_signature', v_request.transaction_signature,
        'payer_address', v_request.payer_address,
        'verified_at', v_request.verified_at,
        'created_at', v_request.created_at
      ),
      'rejection_count', v_request.rejection_count
    );

  END IF;

  -- Reject consumed attempts
  IF v_attempt.consumed_at IS NOT NULL THEN
    RETURN jsonb_build_error_message(
      'Attempt has already been consumed.'
    );
  END IF;

  -- Reject invalidated attempts
  IF v_attempt.invalidated_at IS NOT NULL THEN
    RETURN jsonb_build_error_message(
      'Attempt has been invalidated.'
    );
  END IF;

  -- Reject expired attempts
  IF v_attempt.expires_at <= NOW() THEN
    RETURN jsonb_build_error_message(
      'Attempt has expired.'
    );
  END IF;

  -- Only pending attempts can be recorded as rejected
  IF v_attempt.result IS DISTINCT FROM 'pending' THEN
    RETURN jsonb_build_error_message(
      'Attempt is not in a pending state.'
    );
  END IF;

  -- Consume attempt exactly once
  UPDATE public.payment_request_attempts
  SET consumed_at = NOW(),
      result = 'rejected'
  WHERE id = v_attempt.id
  RETURNING * INTO v_attempt;

  -- Increment rejection count atomically
  UPDATE public.payment_requests
  SET rejection_count = rejection_count + 1
  WHERE id = v_request.id
    AND status = 'pending'
  RETURNING rejection_count INTO v_new_rejection_count;

  -- Defensive check: should be unreachable due to row lock.
  IF v_new_rejection_count IS NULL THEN
    RAISE EXCEPTION
      'Payment request status changed during rejection recording.';
  END IF;

  -- Three recorded rejections mark the request failed
  IF v_new_rejection_count >= 3 THEN
    UPDATE public.payment_requests
    SET status = 'failed'
    WHERE id = v_request.id
      AND status = 'pending';
  END IF;

  -- Read final request status
  SELECT status
  INTO v_current_status
  FROM public.payment_requests
  WHERE id = v_request.id;

  RETURN jsonb_build_object(
    'success', true,
    'recorded', true,
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


-- ============================================================
-- 3. PRESERVE SERVICE-ROLE-ONLY EXECUTION
-- ============================================================

REVOKE ALL ON FUNCTION public.record_attempt_issuance(
  TEXT, TEXT, TIMESTAMPTZ, INET, TEXT
) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.record_attempt_issuance(
  TEXT, TEXT, TIMESTAMPTZ, INET, TEXT
) FROM anon;

REVOKE ALL ON FUNCTION public.record_attempt_issuance(
  TEXT, TEXT, TIMESTAMPTZ, INET, TEXT
) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.record_attempt_issuance(
  TEXT, TEXT, TIMESTAMPTZ, INET, TEXT
) TO service_role;


REVOKE ALL ON FUNCTION public.record_attempt_rejection(
  TEXT, TEXT
) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.record_attempt_rejection(
  TEXT, TEXT
) FROM anon;

REVOKE ALL ON FUNCTION public.record_attempt_rejection(
  TEXT, TEXT
) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.record_attempt_rejection(
  TEXT, TEXT
) TO service_role;


-- ============================================================
-- END MIGRATION
-- ============================================================
