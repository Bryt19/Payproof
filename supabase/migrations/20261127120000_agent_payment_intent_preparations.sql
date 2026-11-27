-- Migration: persist agentic payment intent transaction preparations
--
-- Purpose (Stage 4 Step 3):
--   1. Record the exact compiled message a preparation produced, so a signed
--      transaction can be proven to be the one PayProof issued for an intent.
--   2. Record the blockhash lifetime and the approval window snapshot used for
--      that preparation, so stale preparations can be rejected.
--   3. Keep an append-only audit trail: preparing again after re-approval adds a
--      row instead of rewriting the previous one.
--
-- It is additive and safe to re-run:
--   * the table is created with IF NOT EXISTS;
--   * indexes use IF NOT EXISTS;
--   * the function uses CREATE OR REPLACE with its existing signature.
-- No existing table, column, constraint, index, policy or grant is changed and
-- no row is deleted.
--
-- Security:
--   * RLS is enabled and every client role is denied.
--   * Only SELECT and INSERT are granted to service_role (no UPDATE, no DELETE):
--     a preparation is evidence, not mutable state.
--   * The RPC is SECURITY INVOKER, pins search_path, locks the intent row and
--     only accepts a preparation for an approved intent inside a live approval
--     window owned by the authenticated merchant wallet.

BEGIN;

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.agent_payment_intent_preparations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    intent_id TEXT NOT NULL
        REFERENCES public.agent_payment_intents (id),
    intent_nonce TEXT NOT NULL,
    merchant_wallet TEXT NOT NULL,
    -- SHA-256 of the compiled message bytes, not of the base64 string.
    message_hash TEXT NOT NULL,
    -- Optional audit copy of the wire transaction hash (unsigned base64).
    transaction_sha256 TEXT,
    blockhash TEXT NOT NULL,
    last_valid_block_height BIGINT NOT NULL,
    -- Snapshot of agent_payment_intents.approval_expires_at at preparation.
    approval_expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT agent_intent_preparation_nonce_format
        CHECK (intent_nonce ~ '^[a-f0-9]{16,64}$'),

    CONSTRAINT agent_intent_preparation_wallet_not_empty
        CHECK (length(trim(merchant_wallet)) > 0),

    CONSTRAINT agent_intent_preparation_message_hash_format
        CHECK (message_hash ~ '^[a-f0-9]{64}$'),

    CONSTRAINT agent_intent_preparation_transaction_hash_format
        CHECK (
            transaction_sha256 IS NULL
            OR transaction_sha256 ~ '^[a-f0-9]{64}$'
        ),

    CONSTRAINT agent_intent_preparation_blockhash_format
        CHECK (blockhash ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),

    CONSTRAINT agent_intent_preparation_block_height_positive
        CHECK (last_valid_block_height > 0),

    CONSTRAINT agent_intent_preparation_approval_window_valid
        CHECK (approval_expires_at > created_at)
);

-- One compiled message is prepared at most once per intent; re-preparing with
-- the same blockhash is idempotent.
CREATE UNIQUE INDEX IF NOT EXISTS agent_intent_preparation_message_key
    ON public.agent_payment_intent_preparations (intent_id, message_hash);

CREATE INDEX IF NOT EXISTS agent_intent_preparation_intent_idx
    ON public.agent_payment_intent_preparations (intent_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

ALTER TABLE public.agent_payment_intent_preparations ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.agent_payment_intent_preparations FROM PUBLIC;
REVOKE ALL ON TABLE public.agent_payment_intent_preparations FROM anon;
REVOKE ALL ON TABLE public.agent_payment_intent_preparations FROM authenticated;

GRANT SELECT, INSERT ON TABLE public.agent_payment_intent_preparations TO service_role;

DROP POLICY IF EXISTS "no client access to agent payment preparations"
    ON public.agent_payment_intent_preparations;

CREATE POLICY "no client access to agent payment preparations"
    ON public.agent_payment_intent_preparations
    FOR ALL
    TO anon, authenticated
    USING (FALSE)
    WITH CHECK (FALSE);

-- ---------------------------------------------------------------------------
-- Record a preparation
--
--   approved, live window, matching wallet -> 'recorded'
--   replay of the same message hash         -> 'recorded' (idempotent insert)
--   draft / submitted / verified / failed   -> 'invalid_status'
--   approved but window elapsed             -> 'approval_expired'
--   unknown nonce / wrong wallet            -> 'unknown' / 'wrong_merchant'
--
-- The approval window snapshot is read from the row, never from the caller, so
-- a preparation cannot claim a longer window than the merchant approved.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.record_agent_payment_intent_preparation(
    p_nonce TEXT,
    p_merchant_wallet TEXT,
    p_message_hash TEXT,
    p_blockhash TEXT,
    p_last_valid_block_height BIGINT
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
       OR length(trim(p_merchant_wallet)) = 0
       OR p_message_hash IS NULL
       OR p_message_hash !~ '^[a-f0-9]{64}$'
       OR p_blockhash IS NULL
       OR p_blockhash !~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'
       OR p_last_valid_block_height IS NULL
       OR p_last_valid_block_height <= 0 THEN
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

    IF v_intent.status <> 'approved' THEN
        RETURN jsonb_build_object(
            'outcome', 'invalid_status',
            'status', v_intent.status
        );
    END IF;

    IF v_intent.approval_expires_at IS NULL
       OR v_intent.approval_expires_at <= NOW() THEN
        RETURN jsonb_build_object('outcome', 'approval_expired');
    END IF;

    INSERT INTO public.agent_payment_intent_preparations (
        intent_id,
        intent_nonce,
        merchant_wallet,
        message_hash,
        blockhash,
        last_valid_block_height,
        approval_expires_at
    )
    VALUES (
        v_intent.id,
        v_intent.nonce,
        v_intent.merchant_wallet,
        p_message_hash,
        p_blockhash,
        p_last_valid_block_height,
        v_intent.approval_expires_at
    )
    ON CONFLICT (intent_id, message_hash) DO NOTHING;

    RETURN jsonb_build_object(
        'outcome', 'recorded',
        'intent_id', v_intent.id,
        'blockhash', p_blockhash,
        'last_valid_block_height', p_last_valid_block_height,
        'approval_expires_at', v_intent.approval_expires_at
    );
END;
$$;

REVOKE ALL ON FUNCTION public.record_agent_payment_intent_preparation(
    TEXT, TEXT, TEXT, TEXT, BIGINT
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_agent_payment_intent_preparation(
    TEXT, TEXT, TEXT, TEXT, BIGINT
) FROM anon;
REVOKE ALL ON FUNCTION public.record_agent_payment_intent_preparation(
    TEXT, TEXT, TEXT, TEXT, BIGINT
) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.record_agent_payment_intent_preparation(
    TEXT, TEXT, TEXT, TEXT, BIGINT
) TO service_role;

COMMENT ON TABLE public.agent_payment_intent_preparations IS
    'Service-role-only record of compiled agentic payment transaction messages. Proves a signed transaction matches a preparation.';

COMMENT ON COLUMN public.agent_payment_intent_preparations.message_hash IS
    'SHA-256 of the compiled message bytes (base64-independent).';

COMMENT ON COLUMN public.agent_payment_intent_preparations.approval_expires_at IS
    'Snapshot of the approval window the preparation was built under.';

COMMENT ON FUNCTION public.record_agent_payment_intent_preparation(
    TEXT, TEXT, TEXT, TEXT, BIGINT
) IS
    'Records one compiled message for an approved intent inside a live approval window. Idempotent per message hash.';

COMMIT;
