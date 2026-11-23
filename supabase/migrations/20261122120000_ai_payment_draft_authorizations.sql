-- Migration: AI payment-draft authorization registry
-- Purpose:
--   1. Persist every signed AI draft authorization server-side.
--   2. Atomically revoke an old nonce and register its replacement.
--   3. Atomically consume an active nonce and create exactly one payment
--      request, returning the original request on a legitimate retry.
--
-- Security:
--   * Service-role access only. RLS is enabled and every client role is denied.
--   * Function execution is revoked from PUBLIC/anon/authenticated.
--   * This migration is additive: it does not alter existing payment
--     verification, settlement or checkout behaviour.

BEGIN;

CREATE TABLE IF NOT EXISTS public.ai_payment_draft_authorizations (
    nonce TEXT PRIMARY KEY,
    merchant_wallet TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    draft_fingerprint TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    consumed_at TIMESTAMPTZ,
    payment_request_id TEXT REFERENCES public.payment_requests (id) ON DELETE RESTRICT,
    processing_started_at TIMESTAMPTZ,

    CONSTRAINT ai_draft_auth_nonce_format
        CHECK (nonce ~ '^[a-f0-9]{32,64}$'),

    CONSTRAINT ai_draft_auth_wallet_not_empty
        CHECK (length(trim(merchant_wallet)) > 0),

    CONSTRAINT ai_draft_auth_status_valid
        CHECK (status IN ('active', 'revoked', 'processing', 'consumed')),

    CONSTRAINT ai_draft_auth_fingerprint_format
        CHECK (draft_fingerprint ~ '^[a-f0-9]{64}$'),

    CONSTRAINT ai_draft_auth_expiry_valid
        CHECK (expires_at > created_at),

    CONSTRAINT ai_draft_auth_consumed_consistency
        CHECK (
            (
                status IN ('active', 'revoked')
                AND consumed_at IS NULL
                AND payment_request_id IS NULL
                AND processing_started_at IS NULL
            )
            OR
            (
                status = 'processing'
                AND consumed_at IS NULL
                AND payment_request_id IS NULL
                AND processing_started_at IS NOT NULL
            )
            OR
            (
                status = 'consumed'
                AND consumed_at IS NOT NULL
                AND payment_request_id IS NOT NULL
                AND processing_started_at IS NULL
            )
        )
);

CREATE INDEX IF NOT EXISTS ai_draft_auth_merchant_idx
    ON public.ai_payment_draft_authorizations (merchant_wallet);

CREATE INDEX IF NOT EXISTS ai_draft_auth_status_expiry_idx
    ON public.ai_payment_draft_authorizations (status, expires_at);

CREATE UNIQUE INDEX IF NOT EXISTS ai_draft_auth_request_unique
    ON public.ai_payment_draft_authorizations (payment_request_id)
    WHERE payment_request_id IS NOT NULL;

ALTER TABLE public.ai_payment_draft_authorizations
    ENABLE ROW LEVEL SECURITY;

-- No client role may read or write the registry, even if a project-level
-- default grant is later added.
REVOKE ALL ON TABLE public.ai_payment_draft_authorizations FROM PUBLIC;
REVOKE ALL ON TABLE public.ai_payment_draft_authorizations FROM anon;
REVOKE ALL ON TABLE public.ai_payment_draft_authorizations FROM authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE
    ON public.ai_payment_draft_authorizations
    TO service_role;

DROP POLICY IF EXISTS "no client access to ai draft authorizations"
    ON public.ai_payment_draft_authorizations;

CREATE POLICY "no client access to ai draft authorizations"
    ON public.ai_payment_draft_authorizations
    FOR ALL
    TO anon, authenticated
    USING (FALSE)
    WITH CHECK (FALSE);


-- ---------------------------------------------------------------------------
-- Re-authorization
--
-- Revokes the old nonce and registers the replacement in one transaction.
-- The application signs the replacement token only after this function
-- succeeds; a failure leaves the old authorization untouched.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.reauthorize_ai_payment_draft_authorization(
    p_old_nonce TEXT,
    p_merchant_wallet TEXT,
    p_new_nonce TEXT,
    p_new_fingerprint TEXT,
    p_new_expires_at TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    v_old public.ai_payment_draft_authorizations%ROWTYPE;
BEGIN
    IF p_old_nonce IS NULL
       OR p_merchant_wallet IS NULL
       OR p_new_nonce IS NULL
       OR p_new_fingerprint IS NULL
       OR p_new_expires_at IS NULL THEN
        RETURN jsonb_build_object('outcome', 'invalid_request');
    END IF;

    IF p_new_nonce !~ '^[a-f0-9]{32,64}$'
       OR p_new_nonce = p_old_nonce
       OR p_new_fingerprint !~ '^[a-f0-9]{64}$' THEN
        RETURN jsonb_build_object('outcome', 'invalid_request');
    END IF;

    IF p_new_expires_at <= NOW() THEN
        RETURN jsonb_build_object('outcome', 'invalid_request');
    END IF;

    SELECT *
    INTO v_old
    FROM public.ai_payment_draft_authorizations
    WHERE nonce = p_old_nonce
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('outcome', 'unknown');
    END IF;

    IF v_old.merchant_wallet <> p_merchant_wallet THEN
        RETURN jsonb_build_object('outcome', 'wrong_merchant');
    END IF;

    IF v_old.status = 'revoked' THEN
        RETURN jsonb_build_object('outcome', 'revoked');
    END IF;

    IF v_old.status = 'consumed' THEN
        RETURN jsonb_build_object('outcome', 'consumed');
    END IF;

    IF v_old.status = 'processing' THEN
        RETURN jsonb_build_object('outcome', 'processing');
    END IF;

    IF v_old.expires_at <= NOW() THEN
        RETURN jsonb_build_object('outcome', 'expired');
    END IF;

    UPDATE public.ai_payment_draft_authorizations
    SET status = 'revoked'
    WHERE nonce = p_old_nonce;

    INSERT INTO public.ai_payment_draft_authorizations (
        nonce,
        merchant_wallet,
        status,
        draft_fingerprint,
        expires_at
    )
    VALUES (
        p_new_nonce,
        p_merchant_wallet,
        'active',
        p_new_fingerprint,
        p_new_expires_at
    );

    RETURN jsonb_build_object('outcome', 'reauthorized');
END;
$$;

REVOKE ALL ON FUNCTION public.reauthorize_ai_payment_draft_authorization(
    TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reauthorize_ai_payment_draft_authorization(
    TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ
) FROM anon;
REVOKE ALL ON FUNCTION public.reauthorize_ai_payment_draft_authorization(
    TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ
) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.reauthorize_ai_payment_draft_authorization(
    TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ
) TO service_role;


-- ---------------------------------------------------------------------------
-- Atomic execution
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
       OR (p_customer_name IS NOT NULL AND length(p_customer_name) > 120)
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

COMMIT;
