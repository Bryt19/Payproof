-- Migration: canonical semantic binding for agentic payment preparations
--
-- Purpose (Stage 4 Step 3 fix):
--   1. Persist a canonical payment-semantics fingerprint alongside the raw
--      compiled-message hash. The raw hash assumes byte-identical wallet
--      serialization; the canonical fingerprint survives harmless account-key
--      reordering while still changing for any changed payment.
--   2. Look preparations up by the blockhash that identifies their lifetime
--      instead of the raw compiled-message hash.
--
-- It is additive and safe to re-run:
--   * the column is added with IF NOT EXISTS and stays nullable, so existing
--     rows are untouched (and are deliberately unusable for submission);
--   * the index uses IF NOT EXISTS;
--   * the six-argument function replaces the former five-argument signature,
--     which is dropped only to avoid an ambiguous overload.
-- No table, column, constraint, index, policy, grant or row is deleted.
--
-- Security:
--   * RLS and grants are unchanged: service_role only, no UPDATE, no DELETE.
--   * The RPC is SECURITY INVOKER, pins search_path, locks the intent row and
--     only accepts a preparation for an approved intent inside a live approval
--     window owned by the authenticated merchant wallet.
--   * The fingerprint is validated as a SHA-256 hex digest before insert.

BEGIN;

-- ---------------------------------------------------------------------------
-- Column and indexes
-- ---------------------------------------------------------------------------

ALTER TABLE public.agent_payment_intent_preparations
    ADD COLUMN IF NOT EXISTS canonical_fingerprint TEXT;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'agent_intent_preparation_canonical_fingerprint_format'
          AND conrelid = 'public.agent_payment_intent_preparations'::regclass
    ) THEN
        ALTER TABLE public.agent_payment_intent_preparations
            ADD CONSTRAINT agent_intent_preparation_canonical_fingerprint_format
            CHECK (
                canonical_fingerprint IS NULL
                OR canonical_fingerprint ~ '^[a-f0-9]{64}$'
            );
    END IF;
END;
$$;

-- Submission resolves the preparation by intent id + blockhash (the lifetime),
-- newest row first.
CREATE INDEX IF NOT EXISTS agent_intent_preparation_blockhash_idx
    ON public.agent_payment_intent_preparations (intent_id, blockhash, created_at DESC);

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

DROP FUNCTION IF EXISTS public.record_agent_payment_intent_preparation(
    TEXT, TEXT, TEXT, TEXT, BIGINT
);

CREATE OR REPLACE FUNCTION public.record_agent_payment_intent_preparation(
    p_nonce TEXT,
    p_merchant_wallet TEXT,
    p_message_hash TEXT,
    p_canonical_fingerprint TEXT,
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
       OR p_canonical_fingerprint IS NULL
       OR p_canonical_fingerprint !~ '^[a-f0-9]{64}$'
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
        canonical_fingerprint,
        blockhash,
        last_valid_block_height,
        approval_expires_at
    )
    VALUES (
        v_intent.id,
        v_intent.nonce,
        v_intent.merchant_wallet,
        p_message_hash,
        p_canonical_fingerprint,
        p_blockhash,
        p_last_valid_block_height,
        v_intent.approval_expires_at
    )
    ON CONFLICT (intent_id, message_hash) DO NOTHING;

    RETURN jsonb_build_object(
        'outcome', 'recorded',
        'intent_id', v_intent.id,
        'canonical_fingerprint', p_canonical_fingerprint,
        'blockhash', p_blockhash,
        'last_valid_block_height', p_last_valid_block_height,
        'approval_expires_at', v_intent.approval_expires_at
    );
END;
$$;

REVOKE ALL ON FUNCTION public.record_agent_payment_intent_preparation(
    TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_agent_payment_intent_preparation(
    TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT
) FROM anon;
REVOKE ALL ON FUNCTION public.record_agent_payment_intent_preparation(
    TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT
) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.record_agent_payment_intent_preparation(
    TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT
) TO service_role;

COMMENT ON COLUMN public.agent_payment_intent_preparations.canonical_fingerprint IS
    'SHA-256 of the canonical payment semantics (order-independent account keys). The submission binding.';

COMMENT ON FUNCTION public.record_agent_payment_intent_preparation(
    TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT
) IS
    'Records one compiled message and its canonical semantics fingerprint for an approved intent inside a live approval window. Idempotent per message hash.';

COMMIT;
