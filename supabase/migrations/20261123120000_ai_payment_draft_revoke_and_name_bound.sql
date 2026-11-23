-- Migration: AI payment-draft customer-name bound + server-side cancellation
-- Purpose:
--   1. Re-create public.execute_ai_payment_draft_authorization() with its
--      customer-name guard aligned to payment_requests.customer_name_length
--      (80 characters, matching CUSTOMER_NAME_MAX_LENGTH in
--      src/lib/payment-requests/validation.ts).
--
--      Before this migration the guard allowed up to 120 characters, so an
--      81-120 character name passed the function's pre-check and then failed
--      the payment_requests CHECK constraint during the INSERT, raising
--      SQLSTATE 23514 instead of returning 'invalid_request'. The application
--      validates at 80 first, so this was only a last-line-of-defence problem,
--      but the failure mode was wrong: the repository maps 23514 to a
--      retryable "unavailable" response, which can never succeed.
--
--   2. Add public.revoke_ai_payment_draft_authorization(), so a merchant who
--      cancels a draft can make its nonce unusable immediately instead of
--      waiting for expiry.
--
-- Everything else is intentionally identical to
-- 20261122120000_ai_payment_draft_authorizations.sql: row locking with
-- SELECT ... FOR UPDATE, merchant ownership checks, expiry checks, fingerprint
-- verification, atomic payment-request insertion, consumed-retry replay,
-- SECURITY INVOKER and SET search_path = public. Function permissions are
-- restated so a fresh apply yields exactly the same grants.
--
-- This migration replaces function bodies only. It does not alter any table,
-- column, index, row-level security policy or existing row, and it does not
-- touch payment verification, settlement or checkout.

BEGIN;

-- ---------------------------------------------------------------------------
-- Atomic execution (unchanged except the customer_name bound: 120 -> 80)
--
-- Claims the active authorization, inserts the payment request, links the
-- request ID and marks the authorization consumed in a single transaction.
-- Any failure rolls back the whole transaction, so a failed creation never
-- leaves a permanent `processing` state. A retry against a consumed nonce
-- returns the original payment request instead of creating a duplicate.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.execute_ai_payment_draft_authorization(
    p_nonce TEXT,
    p_merchant_wallet TEXT,
    p_request_id TEXT,
    p_reference TEXT,
    p_amount_lamports TEXT,
    p_description TEXT,
    p_customer_name TEXT,
    p_customer_email TEXT,
    p_draft_fingerprint TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    v_auth public.ai_payment_draft_authorizations%ROWTYPE;
    v_request JSONB;
BEGIN
    IF p_nonce IS NULL
       OR p_nonce !~ '^[a-f0-9]{32,64}$'
       OR p_merchant_wallet IS NULL
       OR length(trim(p_merchant_wallet)) = 0
       OR p_draft_fingerprint IS NULL
       OR p_draft_fingerprint !~ '^[a-f0-9]{64}$'
       OR p_request_id IS NULL
       OR length(trim(p_request_id)) = 0
       OR p_reference IS NULL
       OR length(trim(p_reference)) = 0
       OR p_amount_lamports IS NULL
       OR p_amount_lamports !~ '^[0-9]+$'
       OR p_amount_lamports::numeric <= 0
       OR p_amount_lamports::numeric > 10000000000
       OR p_description IS NULL
       OR length(trim(p_description)) < 3
       OR length(p_description) > 200
       OR (p_customer_name IS NOT NULL AND length(p_customer_name) > 80)
       OR (p_customer_email IS NOT NULL AND length(p_customer_email) > 254) THEN
        RETURN jsonb_build_object('outcome', 'invalid_request');
    END IF;

    SELECT *
    INTO v_auth
    FROM public.ai_payment_draft_authorizations
    WHERE nonce = p_nonce
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('outcome', 'unknown');
    END IF;

    IF v_auth.merchant_wallet <> p_merchant_wallet THEN
        RETURN jsonb_build_object('outcome', 'wrong_merchant');
    END IF;

    IF v_auth.draft_fingerprint <> p_draft_fingerprint THEN
        RETURN jsonb_build_object('outcome', 'fingerprint_mismatch');
    END IF;

    IF v_auth.status = 'consumed' THEN
        SELECT to_jsonb(requests)
        INTO v_request
        FROM public.payment_requests AS requests
        WHERE requests.id = v_auth.payment_request_id;

        RETURN jsonb_build_object(
            'outcome', 'already_consumed',
            'request', v_request
        );
    END IF;

    IF v_auth.status = 'revoked' THEN
        RETURN jsonb_build_object('outcome', 'revoked');
    END IF;

    IF v_auth.status = 'processing' THEN
        RETURN jsonb_build_object('outcome', 'processing');
    END IF;

    IF v_auth.expires_at <= NOW() THEN
        RETURN jsonb_build_object('outcome', 'expired');
    END IF;

    UPDATE public.ai_payment_draft_authorizations
    SET
        status = 'processing',
        processing_started_at = NOW()
    WHERE nonce = p_nonce;

    INSERT INTO public.payment_requests AS created_request (
        id,
        reference,
        amount_lamports,
        description,
        customer_name,
        customer_email,
        merchant_address,
        status
    )
    VALUES (
        p_request_id,
        p_reference,
        p_amount_lamports,
        p_description,
        p_customer_name,
        p_customer_email,
        p_merchant_wallet,
        'pending'
    )
    RETURNING to_jsonb(created_request) INTO v_request;

    UPDATE public.ai_payment_draft_authorizations
    SET
        status = 'consumed',
        payment_request_id = p_request_id,
        consumed_at = NOW(),
        processing_started_at = NULL
    WHERE nonce = p_nonce;

    RETURN jsonb_build_object(
        'outcome', 'created',
        'request', v_request
    );
END;
$$;

REVOKE ALL ON FUNCTION public.execute_ai_payment_draft_authorization(
    TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.execute_ai_payment_draft_authorization(
    TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) FROM anon;
REVOKE ALL ON FUNCTION public.execute_ai_payment_draft_authorization(
    TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.execute_ai_payment_draft_authorization(
    TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) TO service_role;


-- ---------------------------------------------------------------------------
-- Revocation on cancellation
--
-- Marks an active authorization revoked so its signed token can no longer be
-- executed. This never creates, modifies or deletes a payment request, and it
-- never consumes an authorization: cancellation is a state change on the nonce
-- only, which keeps the Part 4 rule that cancelling must not count as approval.
--
-- State machine:
--   * active    -> revoked            (the only transition this function makes)
--   * revoked   -> revoked            (idempotent: a repeated cancel is a no-op)
--   * consumed  -> outcome 'consumed' (an approval already won; the request
--                                      exists and must never be undone or
--                                      reported as a successful cancellation)
--   * processing-> outcome 'processing' (a concurrent execution holds the row;
--                                      the caller must retry and will then see
--                                      'consumed' or 'revoked'). The row is left
--                                      untouched because the table requires a
--                                      processing row to carry
--                                      processing_started_at and no request ID,
--                                      so writing 'revoked' here would violate
--                                      ai_draft_auth_consumed_consistency.
--   * expired   -> revoked            (harmless: an expired nonce is already
--                                      unusable, and revoking it keeps repeated
--                                      cancellation safe and idempotent)
--
-- Race safety against simultaneous approval comes from the same SELECT ...
-- FOR UPDATE lock the executor takes on the nonce row:
--   * cancel first  -> approval blocks, then sees 'revoked' and returns
--                      'revoked' without inserting anything;
--   * approval first -> cancel blocks, then sees 'consumed' and returns
--                      'consumed' without modifying the row.
-- The merchant wallet is always supplied by the authenticated session; it is
-- never read from a request body, and a mismatched wallet returns
-- 'wrong_merchant' without touching the row.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.revoke_ai_payment_draft_authorization(
    p_nonce TEXT,
    p_merchant_wallet TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    v_auth public.ai_payment_draft_authorizations%ROWTYPE;
BEGIN
    IF p_nonce IS NULL
       OR p_nonce !~ '^[a-f0-9]{32,64}$'
       OR p_merchant_wallet IS NULL
       OR length(trim(p_merchant_wallet)) = 0 THEN
        RETURN jsonb_build_object('outcome', 'invalid_request');
    END IF;

    SELECT *
    INTO v_auth
    FROM public.ai_payment_draft_authorizations
    WHERE nonce = p_nonce
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('outcome', 'unknown');
    END IF;

    IF v_auth.merchant_wallet <> p_merchant_wallet THEN
        RETURN jsonb_build_object('outcome', 'wrong_merchant');
    END IF;

    IF v_auth.status = 'consumed' THEN
        RETURN jsonb_build_object('outcome', 'consumed');
    END IF;

    IF v_auth.status = 'revoked' THEN
        RETURN jsonb_build_object('outcome', 'revoked');
    END IF;

    IF v_auth.status = 'processing' THEN
        RETURN jsonb_build_object('outcome', 'processing');
    END IF;

    UPDATE public.ai_payment_draft_authorizations
    SET status = 'revoked'
    WHERE nonce = p_nonce;

    RETURN jsonb_build_object('outcome', 'revoked');
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_ai_payment_draft_authorization(
    TEXT, TEXT
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.revoke_ai_payment_draft_authorization(
    TEXT, TEXT
) FROM anon;
REVOKE ALL ON FUNCTION public.revoke_ai_payment_draft_authorization(
    TEXT, TEXT
) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.revoke_ai_payment_draft_authorization(
    TEXT, TEXT
) TO service_role;

COMMIT;
