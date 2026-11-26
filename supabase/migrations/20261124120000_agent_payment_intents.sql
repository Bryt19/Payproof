-- Migration: agentic payment intent authorization registry
-- Purpose:
--   1. Persist one row per validated outbound SOL payment intent.
--   2. Approve an authorization exactly once, idempotently.
--   3. Rotate an edited intent onto a new nonce atomically.
--   4. Revoke a draft authorization so its token can never be approved.
--
-- Security:
--   * Impersonation is impossible: every RPC is executed by the service role
--     (SECURITY INVOKER + SET search_path = public) and every row is scoped to
--     the authenticated merchant wallet supplied by the caller.
--   * Single-use approval: the executor locks the nonce row with
--     SELECT ... FOR UPDATE, so two concurrent approvals cannot both transition
--     `draft` -> `approved`.
--   * Replay: the nonce is unique, so a consumed or re-authorized nonce cannot
--     be reused by an older token.
--   * Duplicate settlement: a partial unique index prevents one transaction
--     signature from settling two intents.
--   * RLS is enabled and every client role is denied. Access is granted only to
--     service_role, and no DELETE grant is given: intents are retained.
--
-- This migration is additive. It does not alter payment_requests, payment
-- verification, merchant_auth or any AI draft authorization object.

BEGIN;

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.agent_payment_intents (
    id TEXT PRIMARY KEY,
    merchant_wallet TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    recipient_address TEXT NOT NULL,
    amount_lamports TEXT NOT NULL,
    purpose TEXT NOT NULL,
    reference TEXT NOT NULL,
    source_kind TEXT NOT NULL,
    source_payment_request_reference TEXT,
    nonce TEXT NOT NULL,
    intent_fingerprint TEXT NOT NULL,
    transaction_signature TEXT,
    payer_address TEXT,
    verified_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT agent_intent_id_not_empty
        CHECK (length(trim(id)) > 0),

    CONSTRAINT agent_intent_wallet_not_empty
        CHECK (length(trim(merchant_wallet)) > 0),

    CONSTRAINT agent_intent_status_valid
        CHECK (status IN (
            'draft', 'approved', 'submitted', 'verified',
            'rejected', 'expired', 'cancelled', 'failed'
        )),

    -- 32-byte base58, the same shape as a Solana wallet address.
    CONSTRAINT agent_intent_recipient_format
        CHECK (recipient_address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),

    -- 32-byte base58, the same shape as a Solana wallet address / reference.
    CONSTRAINT agent_intent_reference_format
        CHECK (reference ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),

    CONSTRAINT agent_intent_nonce_format
        CHECK (nonce ~ '^[a-f0-9]{16,64}$'),

    CONSTRAINT agent_intent_fingerprint_format
        CHECK (intent_fingerprint ~ '^[a-f0-9]{64}$'),

    -- Amount is an integer lamport string. The length bound keeps the bigint
    -- cast safe; the upper bound is the 10 SOL cap used by every PayProof form.
    CONSTRAINT agent_intent_amount_bounds
        CHECK (
            amount_lamports ~ '^[0-9]{1,11}$'
            AND amount_lamports::bigint > 0
            AND amount_lamports::bigint <= 10000000000
        ),

    CONSTRAINT agent_intent_purpose_length
        CHECK (
            length(trim(purpose)) >= 3
            AND length(purpose) <= 200
        ),

    CONSTRAINT agent_intent_source_kind_valid
        CHECK (source_kind IN ('address', 'payment_request')),

    -- An address-sourced intent carries no reference; a payment-request-sourced
    -- intent must carry the reference it will be resolved from.
    CONSTRAINT agent_intent_source_consistency
        CHECK (
            (source_kind = 'address' AND source_payment_request_reference IS NULL)
            OR
            (source_kind = 'payment_request' AND source_payment_request_reference IS NOT NULL)
        ),

    CONSTRAINT agent_intent_expiry_valid
        CHECK (expires_at > created_at),

    -- Verified evidence is mandatory. A row can never claim settlement without
    -- the signature, payer and verification time written by the verifier.
    CONSTRAINT agent_intent_verified_consistency
        CHECK (
            status <> 'verified'
            OR (
                transaction_signature IS NOT NULL
                AND payer_address IS NOT NULL
                AND verified_at IS NOT NULL
            )
        )
);

-- The nonce is the authorization key: unique so a token can never be replayed.
CREATE UNIQUE INDEX IF NOT EXISTS agent_intent_nonce_key
    ON public.agent_payment_intents (nonce);

-- The on-chain reference identifies exactly one intent.
CREATE UNIQUE INDEX IF NOT EXISTS agent_intent_reference_key
    ON public.agent_payment_intents (reference);

-- One settled transaction can pay for at most one intent.
CREATE UNIQUE INDEX IF NOT EXISTS agent_intent_signature_key
    ON public.agent_payment_intents (transaction_signature)
    WHERE transaction_signature IS NOT NULL;

CREATE INDEX IF NOT EXISTS agent_intent_merchant_idx
    ON public.agent_payment_intents (merchant_wallet);

CREATE INDEX IF NOT EXISTS agent_intent_status_expiry_idx
    ON public.agent_payment_intents (status, expires_at);

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

ALTER TABLE public.agent_payment_intents ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.agent_payment_intents FROM PUBLIC;
REVOKE ALL ON TABLE public.agent_payment_intents FROM anon;
REVOKE ALL ON TABLE public.agent_payment_intents FROM authenticated;

-- Minimum required privileges: the registry inserts, reads and updates. There
-- is no DELETE grant, so an intent cannot be erased to hide a settlement.
GRANT SELECT, INSERT, UPDATE ON TABLE public.agent_payment_intents TO service_role;

DROP POLICY IF EXISTS "no client access to agent payment intents"
    ON public.agent_payment_intents;

CREATE POLICY "no client access to agent payment intents"
    ON public.agent_payment_intents
    FOR ALL
    TO anon, authenticated
    USING (FALSE)
    WITH CHECK (FALSE);


-- ---------------------------------------------------------------------------
-- Approval: consume an authorization exactly once
--
-- State machine:
--   draft      -> approved          (the only transition this function makes)
--   approved   -> already_approved  (idempotent retry; returns the same row)
--   submitted  -> already_approved  (approval already won)
--   verified   -> already_approved
--   cancelled  -> revoked
--   expired    -> expired           (draft rows past expiry are marked expired)
--   rejected / failed -> invalid_status
--
-- Race safety: the SELECT ... FOR UPDATE lock serialises concurrent approvals.
-- The second caller blocks, then observes `approved` and gets
-- `already_approved` with the original row instead of a duplicate.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.approve_agent_payment_intent(
    p_nonce TEXT,
    p_merchant_wallet TEXT,
    p_fingerprint TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    v_intent public.agent_payment_intents%ROWTYPE;
    v_row JSONB;
BEGIN
    IF p_nonce IS NULL
       OR p_nonce !~ '^[a-f0-9]{16,64}$'
       OR p_merchant_wallet IS NULL
       OR length(trim(p_merchant_wallet)) = 0
       OR p_fingerprint IS NULL
       OR p_fingerprint !~ '^[a-f0-9]{64}$' THEN
        RETURN jsonb_build_object('outcome', 'invalid_request');
    END IF;

    SELECT *
    INTO v_intent
    FROM public.agent_payment_intents
    WHERE nonce = p_nonce
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('outcome', 'unknown');
    END IF;

    IF v_intent.merchant_wallet <> p_merchant_wallet THEN
        RETURN jsonb_build_object('outcome', 'wrong_merchant');
    END IF;

    IF v_intent.intent_fingerprint <> p_fingerprint THEN
        RETURN jsonb_build_object('outcome', 'fingerprint_mismatch');
    END IF;

    IF v_intent.status IN ('approved', 'submitted', 'verified') THEN
        SELECT to_jsonb(i)
        INTO v_row
        FROM public.agent_payment_intents AS i
        WHERE i.id = v_intent.id;

        RETURN jsonb_build_object(
            'outcome', 'already_approved',
            'intent', v_row
        );
    END IF;

    IF v_intent.status = 'cancelled' THEN
        RETURN jsonb_build_object('outcome', 'revoked');
    END IF;

    IF v_intent.status = 'expired' THEN
        RETURN jsonb_build_object('outcome', 'expired');
    END IF;

    IF v_intent.status <> 'draft' THEN
        RETURN jsonb_build_object(
            'outcome', 'invalid_status',
            'status', v_intent.status
        );
    END IF;

    IF v_intent.expires_at <= NOW() THEN
        UPDATE public.agent_payment_intents
        SET status = 'expired'
        WHERE id = v_intent.id;

        RETURN jsonb_build_object('outcome', 'expired');
    END IF;

    UPDATE public.agent_payment_intents
    SET status = 'approved'
    WHERE id = v_intent.id;

    SELECT to_jsonb(i)
    INTO v_row
    FROM public.agent_payment_intents AS i
    WHERE i.id = v_intent.id;

    RETURN jsonb_build_object(
        'outcome', 'approved',
        'intent', v_row
    );
END;
$$;

REVOKE ALL ON FUNCTION public.approve_agent_payment_intent(
    TEXT, TEXT, TEXT
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.approve_agent_payment_intent(
    TEXT, TEXT, TEXT
) FROM anon;
REVOKE ALL ON FUNCTION public.approve_agent_payment_intent(
    TEXT, TEXT, TEXT
) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.approve_agent_payment_intent(
    TEXT, TEXT, TEXT
) TO service_role;


-- ---------------------------------------------------------------------------
-- Re-authorization: rotate an edited draft onto a new nonce
--
-- The row is updated in place, so the intent ID and its on-chain reference stay
-- stable while the old nonce disappears. A stale old token therefore resolves to
-- `unknown` and can never be approved. The UPDATE and the nonce uniqueness
-- constraint are one transaction: a collision rolls the whole rotation back and
-- leaves the old authorization untouched.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.reauthorize_agent_payment_intent(
    p_nonce TEXT,
    p_merchant_wallet TEXT,
    p_new_nonce TEXT,
    p_new_fingerprint TEXT,
    p_new_expires_at TIMESTAMPTZ,
    p_recipient_address TEXT,
    p_amount_lamports TEXT,
    p_purpose TEXT,
    p_source_kind TEXT,
    p_source_payment_request_reference TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    v_intent public.agent_payment_intents%ROWTYPE;
    v_row JSONB;
BEGIN
    IF p_nonce IS NULL
       OR p_nonce !~ '^[a-f0-9]{16,64}$'
       OR p_merchant_wallet IS NULL
       OR length(trim(p_merchant_wallet)) = 0
       OR p_new_nonce IS NULL
       OR p_new_nonce !~ '^[a-f0-9]{16,64}$'
       OR p_new_nonce = p_nonce
       OR p_new_fingerprint IS NULL
       OR p_new_fingerprint !~ '^[a-f0-9]{64}$'
       OR p_new_expires_at IS NULL
       OR p_new_expires_at <= NOW()
       OR p_recipient_address IS NULL
       OR p_recipient_address !~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'
       OR p_amount_lamports IS NULL
       OR p_amount_lamports !~ '^[0-9]{1,11}$'
       OR p_amount_lamports::bigint <= 0
       OR p_amount_lamports::bigint > 10000000000
       OR p_purpose IS NULL
       OR length(trim(p_purpose)) < 3
       OR length(p_purpose) > 200
       OR p_source_kind IS NULL
       OR p_source_kind NOT IN ('address', 'payment_request')
       OR (p_source_kind = 'address' AND p_source_payment_request_reference IS NOT NULL)
       OR (p_source_kind = 'payment_request' AND p_source_payment_request_reference IS NULL) THEN
        RETURN jsonb_build_object('outcome', 'invalid_request');
    END IF;

    SELECT *
    INTO v_intent
    FROM public.agent_payment_intents
    WHERE nonce = p_nonce
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('outcome', 'unknown');
    END IF;

    IF v_intent.merchant_wallet <> p_merchant_wallet THEN
        RETURN jsonb_build_object('outcome', 'wrong_merchant');
    END IF;

    IF v_intent.status IN ('approved', 'submitted', 'verified') THEN
        RETURN jsonb_build_object('outcome', 'approved');
    END IF;

    IF v_intent.status = 'cancelled' THEN
        RETURN jsonb_build_object('outcome', 'revoked');
    END IF;

    IF v_intent.status = 'expired' THEN
        RETURN jsonb_build_object('outcome', 'expired');
    END IF;

    IF v_intent.status <> 'draft' THEN
        RETURN jsonb_build_object(
            'outcome', 'invalid_status',
            'status', v_intent.status
        );
    END IF;

    IF v_intent.expires_at <= NOW() THEN
        UPDATE public.agent_payment_intents
        SET status = 'expired'
        WHERE id = v_intent.id;

        RETURN jsonb_build_object('outcome', 'expired');
    END IF;

    UPDATE public.agent_payment_intents
    SET
        nonce = p_new_nonce,
        intent_fingerprint = p_new_fingerprint,
        expires_at = p_new_expires_at,
        recipient_address = p_recipient_address,
        amount_lamports = p_amount_lamports,
        purpose = p_purpose,
        source_kind = p_source_kind,
        source_payment_request_reference = p_source_payment_request_reference
    WHERE id = v_intent.id;

    SELECT to_jsonb(i)
    INTO v_row
    FROM public.agent_payment_intents AS i
    WHERE i.id = v_intent.id;

    RETURN jsonb_build_object(
        'outcome', 'reauthorized',
        'intent', v_row
    );
END;
$$;

REVOKE ALL ON FUNCTION public.reauthorize_agent_payment_intent(
    TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reauthorize_agent_payment_intent(
    TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, TEXT
) FROM anon;
REVOKE ALL ON FUNCTION public.reauthorize_agent_payment_intent(
    TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, TEXT
) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.reauthorize_agent_payment_intent(
    TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, TEXT
) TO service_role;


-- ---------------------------------------------------------------------------
-- Revocation on cancellation
--
-- draft     -> cancelled, outcome 'revoked'
-- cancelled -> 'revoked'   (idempotent)
-- expired   -> 'expired'   (never silently revived)
-- approved / submitted / verified -> 'approved' (an approval already won)
--
-- Race safety comes from the same FOR UPDATE lock: revoke first means approval
-- blocks and then sees `cancelled`; approval first means revoke sees `approved`
-- and refuses.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.revoke_agent_payment_intent(
    p_nonce TEXT,
    p_merchant_wallet TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    v_intent public.agent_payment_intents%ROWTYPE;
BEGIN
    IF p_nonce IS NULL
       OR p_nonce !~ '^[a-f0-9]{16,64}$'
       OR p_merchant_wallet IS NULL
       OR length(trim(p_merchant_wallet)) = 0 THEN
        RETURN jsonb_build_object('outcome', 'invalid_request');
    END IF;

    SELECT *
    INTO v_intent
    FROM public.agent_payment_intents
    WHERE nonce = p_nonce
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('outcome', 'unknown');
    END IF;

    IF v_intent.merchant_wallet <> p_merchant_wallet THEN
        RETURN jsonb_build_object('outcome', 'wrong_merchant');
    END IF;

    IF v_intent.status IN ('approved', 'submitted', 'verified') THEN
        RETURN jsonb_build_object('outcome', 'approved');
    END IF;

    IF v_intent.status = 'cancelled' THEN
        RETURN jsonb_build_object('outcome', 'revoked');
    END IF;

    IF v_intent.status = 'expired' THEN
        RETURN jsonb_build_object('outcome', 'expired');
    END IF;

    IF v_intent.status <> 'draft' THEN
        RETURN jsonb_build_object(
            'outcome', 'invalid_status',
            'status', v_intent.status
        );
    END IF;

    IF v_intent.expires_at <= NOW() THEN
        UPDATE public.agent_payment_intents
        SET status = 'expired'
        WHERE id = v_intent.id;

        RETURN jsonb_build_object('outcome', 'expired');
    END IF;

    UPDATE public.agent_payment_intents
    SET status = 'cancelled'
    WHERE id = v_intent.id;

    RETURN jsonb_build_object('outcome', 'revoked');
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_agent_payment_intent(
    TEXT, TEXT
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.revoke_agent_payment_intent(
    TEXT, TEXT
) FROM anon;
REVOKE ALL ON FUNCTION public.revoke_agent_payment_intent(
    TEXT, TEXT
) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.revoke_agent_payment_intent(
    TEXT, TEXT
) TO service_role;

COMMENT ON TABLE public.agent_payment_intents IS
    'Service-role-only authorization registry for merchant-initiated outbound SOL payment intents.';

COMMENT ON COLUMN public.agent_payment_intents.nonce IS
    'Single-use authorization nonce bound to the signed intent token.';

COMMENT ON COLUMN public.agent_payment_intents.intent_fingerprint IS
    'SHA-256 over the canonical intent, merchant wallet and nonce.';

COMMIT;
