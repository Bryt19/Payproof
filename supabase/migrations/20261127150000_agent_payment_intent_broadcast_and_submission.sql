-- Migration: agentic payment intent broadcast and submission state
-- Purpose (Stage 4 Step 1):
--   1. Add durable fields for signed transaction storage, broadcast tracking,
--      and on‑chain fee recording.
--   2. Update submit_agent_payment_intent to persist transaction_base64.
--   3. Create claim_agent_payment_broadcast and record_agent_payment_broadcast
--      for safe broadcast recovery.
--   4. Update verify_agent_payment_intent to accept a trusted verification result
--      and persist verified / verified_fee_exception / failed / manual_review outcomes.
--   5. Add lifecycle guards so terminal states cannot be reused, cancelled or
--      reauthorized, and submitted intents cannot be approved or reauthorized.
--   6. Extend the status CHECK constraint with verified_fee_exception and
--      manual_review.
--   6. Enforce security: all new/replaced RPCs are SECURITY INVOKER, search_path = public,
--      merchant‑wallet validation, row locking, service_role only.
--
-- This migration is additive – it only adds columns, new functions, and revises
-- existing functions. No existing data is altered except by setting defaults.

-- ---------------------------------------------------------------------------
-- 1️⃣  Add durable columns to agent_payment_intents
-- ---------------------------------------------------------------------------

ALTER TABLE public.agent_payment_intents
    ADD COLUMN IF NOT EXISTS transaction_base64 TEXT;

ALTER TABLE public.agent_payment_intents
    ADD COLUMN IF NOT EXISTS broadcast_status TEXT NOT NULL
        DEFAULT 'pending'
        CONSTRAINT broadcast_status_check
        CHECK (broadcast_status IN ('pending','claimed','accepted','unknown'));

ALTER TABLE public.agent_payment_intents
    ADD COLUMN IF NOT EXISTS broadcast_attempt_count INTEGER NOT NULL
        DEFAULT 0
        CONSTRAINT broadcast_attempt_nonneg_check CHECK (broadcast_attempt_count >= 0);

ALTER TABLE public.agent_payment_intents
    ADD COLUMN IF NOT EXISTS broadcast_attempted_at TIMESTAMPTZ NULL;

ALTER TABLE public.agent_payment_intents
    ADD COLUMN IF NOT EXISTS broadcast_response_at TIMESTAMPTZ NULL;

ALTER TABLE public.agent_payment_intents
    ADD COLUMN IF NOT EXISTS broadcast_lease_token TEXT NULL;

ALTER TABLE public.agent_payment_intents
    ADD COLUMN IF NOT EXISTS broadcast_lease_expires_at TIMESTAMPTZ NULL;

ALTER TABLE public.agent_payment_intents
    ADD COLUMN IF NOT EXISTS broadcast_last_error TEXT NULL;

ALTER TABLE public.agent_payment_intents
    ADD COLUMN IF NOT EXISTS meta_fee_lamports TEXT NULL
        CONSTRAINT meta_fee_lamports_check
        CHECK (meta_fee_lamports ~ '^[0-9]{1,20}$' OR meta_fee_lamports IS NULL);

-- ---------------------------------------------------------------------------
-- 2️⃣  Add supporting indexes (optional but helpful for query planning)
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS ix_agent_payment_intents_broadcast_status
    ON public.agent_payment_intents (broadcast_status);

CREATE INDEX IF NOT EXISTS ix_agent_payment_intents_broadcast_lease
    ON public.agent_payment_intents (broadcast_lease_token)
    WHERE broadcast_lease_token IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3️⃣  Status constraint: drop old and add authoritative constraint
-- ---------------------------------------------------------------------------

-- Remove the existing constraint (safe on re‑run)
ALTER TABLE public.agent_payment_intents
    DROP CONSTRAINT IF EXISTS agent_intent_status_valid;

-- Add the full‑life‑cycle constraint with all legitimate statuses
ALTER TABLE public.agent_payment_intents
    ADD CONSTRAINT agent_intent_status_valid
    CHECK (status IN (
        'draft','approved','submitted','verified',
        'verified_fee_exception','manual_review',
        'rejected','expired','cancelled','failed'
    ));

-- ---------------------------------------------------------------------------
-- 4️⃣  Updated submit_agent_payment_intent
--    – p_transaction_base64 is mandatory (no default).
--    – Rejects NULL, empty, or malformed base64.
--    – Stores exact signed bytes alongside the signature.
--    – Idempotent retry matches both signature and transaction bytes
--      without resetting broadcast state.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.submit_agent_payment_intent(
    p_nonce               TEXT,
    p_merchant_wallet     TEXT,
    p_signature           TEXT,
    p_payer_address       TEXT,
    p_transaction_base64  TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    v_intent public.agent_payment_intents%ROWTYPE;
    v_row    JSONB;
BEGIN
    -- ---- input validation -------------------------------------------------
    IF p_nonce IS NULL
       OR p_nonce !~ '^[a-f0-9]{16,64}$'
       OR p_merchant_wallet IS NULL
       OR length(trim(p_merchant_wallet)) = 0
       OR p_signature IS NULL
       OR p_signature !~ '^[1-9A-HJ-NP-Za-km-z]{64,88}$'
       OR p_payer_address IS NULL
       OR p_payer_address !~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'
       OR p_payer_address <> p_merchant_wallet
       OR p_transaction_base64 IS NULL
       OR length(trim(p_transaction_base64)) = 0
       OR p_transaction_base64 !~ '^[A-Za-z0-9+/]+=*$' THEN
        RETURN jsonb_build_object('outcome', 'invalid_request');
    END IF;

    SELECT * INTO v_intent FROM public.agent_payment_intents WHERE nonce = p_nonce FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('outcome', 'unknown');
    END IF;

    -- ---- merchant‑wallet guard -------------------------------------------
    IF v_intent.merchant_wallet <> p_merchant_wallet THEN
        RETURN jsonb_build_object('outcome', 'wrong_merchant');
    END IF;

    -- ---- terminal‑state guards -------------------------------------------
    IF v_intent.status = 'submitted' THEN
        -- idempotent retry: same signature AND same transaction bytes
        IF v_intent.transaction_signature = p_signature
           AND v_intent.transaction_base64 = p_transaction_base64 THEN
            SELECT to_jsonb(i) INTO v_row FROM public.agent_payment_intents AS i WHERE i.id = v_intent.id;
            RETURN jsonb_build_object('outcome', 'already_submitted', 'intent', v_row);
        END IF;
        -- different signature or different bytes → conflict
        RETURN jsonb_build_object('outcome', 'signature_conflict');
    END IF;

    IF v_intent.status = 'verified' THEN
        RETURN jsonb_build_object('outcome', 'already_verified');
    END IF;

    IF v_intent.status IN ('cancelled','expired') THEN
        RETURN jsonb_build_object('outcome', 'invalid_status');
    END IF;

    IF v_intent.status <> 'approved' THEN
        RETURN jsonb_build_object('outcome', 'not_approved');
    END IF;

    IF v_intent.approval_expires_at IS NULL
       OR v_intent.approval_expires_at <= NOW() THEN
        RETURN jsonb_build_object('outcome', 'approval_expired');
    END IF;

    ---- atomic registration ------------------------------------------------
    BEGIN
        UPDATE public.agent_payment_intents
        SET
            status               = 'submitted',
            transaction_signature = p_signature,
            payer_address        = p_payer_address,
            transaction_base64   = p_transaction_base64,
            submitted_at         = NOW(),
            -- initialise broadcast tracking fields
            broadcast_status     = 'pending',
            broadcast_attempt_count = 0,
            broadcast_attempted_at = NOW(),
            broadcast_response_at = NULL,
            broadcast_lease_token = NULL,
            broadcast_lease_expires_at = NULL,
            broadcast_last_error = NULL
        WHERE id = v_intent.id;
    EXCEPTION WHEN unique_violation THEN
        RETURN jsonb_build_object('outcome', 'signature_conflict');
    END;

    SELECT to_jsonb(i) INTO v_row FROM public.agent_payment_intents AS i WHERE i.id = v_intent.id;

    RETURN jsonb_build_object('outcome', 'submitted', 'intent', v_row);
END;
$$;

REVOKE ALL ON FUNCTION public.submit_agent_payment_intent (TEXT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_agent_payment_intent (TEXT,TEXT,TEXT,TEXT,TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.submit_agent_payment_intent (TEXT,TEXT,TEXT,TEXT,TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.submit_agent_payment_intent (TEXT,TEXT,TEXT,TEXT,TEXT) TO service_role;

-- ---------------------------------------------------------------------------
-- 5️⃣  Corrected claim_agent_payment_broadcast
--    – Only for submitted intents with stored signature and non‑empty bytes.
--    – Validates merchant wallet.
--    – Rejects active lease.
--    – Allows recovery only when previous lease expired or state is retryable.
--    – Does NOT claim verified, failed, manual_review, cancelled, or expired intents.
--    – Declares every variable; fixes invalid v_lease_seconds E type.
--    – Returns the newly stored lease expiry.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.claim_agent_payment_broadcast(
    p_intent_id   TEXT,
    p_merchant_wallet TEXT,
    p_claim_token   TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    v_intent public.agent_payment_intents%ROWTYPE;
    v_now    TIMESTAMPTZ := NOW();
    v_lease_seconds INTEGER DEFAULT 3600; -- 1‑hour lease, configurable
    v_row    JSONB;
BEGIN
    -- ---- basic validation -------------------------------------------------
    IF p_intent_id IS NULL
       OR p_merchant_wallet IS NULL
       OR length(trim(p_merchant_wallet)) = 0
       OR p_claim_token IS NULL
       OR length(p_claim_token) < 32 THEN
        RETURN jsonb_build_object('outcome', 'invalid_request');
    END IF;

    SELECT * INTO v_intent FROM public.agent_payment_intents WHERE id = p_intent_id FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('outcome', 'unknown_intent');
    END IF;

    -- Only submitted intents with a stored signature and transaction bytes may be claimed
    IF v_intent.status != 'submitted' THEN
        RETURN jsonb_build_object('outcome', 'invalid_status', 'status', v_intent.status);
    END IF;

    IF v_intent.transaction_signature IS NULL THEN
        RETURN jsonb_build_object('outcome', 'missing_signature');
    END IF;

    IF v_intent.transaction_base64 IS NULL OR length(trim(v_intent.transaction_base64)) = 0 THEN
        RETURN jsonb_build_object('outcome', 'missing_transaction_bytes');
    END IF;

    -- Validate merchant wallet
    IF v_intent.merchant_wallet <> p_merchant_wallet THEN
        RETURN jsonb_build_object('outcome', 'wrong_merchant');
    END IF;

    ---- lease logic --------------------------------------------------------
    -- If an active lease exists (claimed + not expired) reject.
    IF v_intent.broadcast_status = 'claimed'
       AND v_intent.broadcast_lease_expires_at > v_now THEN
        RETURN jsonb_build_object('outcome', 'active_lease');
    END IF;

    -- Otherwise overwrite any stale lease (expired or unknown) and claim.
    UPDATE public.agent_payment_intents
    SET
        broadcast_status      = 'claimed',
        broadcast_lease_token = p_claim_token,
        broadcast_lease_expires_at = v_now + v_lease_seconds,
        broadcast_attempt_count = broadcast_attempt_count + 1,
        broadcast_attempted_at = v_now,
        broadcast_last_error = NULL
    WHERE id = v_intent.id;

    SELECT to_jsonb(i) INTO v_row FROM public.agent_payment_intents AS i WHERE i.id = v_intent.id;

    RETURN jsonb_build_object(
        'outcome', 'claimed',
        'intent', v_row,
        'stored_tx', v_intent.transaction_base64,
        'stored_sig', v_intent.transaction_signature,
        'lease_token', p_claim_token,
        'lease_expires_at', v_intent.broadcast_lease_expires_at
    );
END;
$$;

REVOKE ALL ON FUNCTION public.claim_agent_payment_broadcast (TEXT,TEXT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_agent_payment_broadcast (TEXT,TEXT,TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.claim_agent_payment_broadcast (TEXT,TEXT,TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_agent_payment_broadcast (TEXT,TEXT,TEXT) TO service_role;

-- ---------------------------------------------------------------------------
-- 6️⃣  Corrected record_agent_payment_broadcast
--    – Verifies the supplied signature matches the stored signature.
--    – Verifies the active lease token and claimed state.
--    – Rejects stale workers.
--    – Accepts only 'accepted' or 'unknown'.
--    – Clears the lease atomically.
--    – Does NOT increment attempt count a second time (claim already did).
--    – Returns the actual updated broadcast status.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.record_agent_payment_broadcast(
    p_intent_id    TEXT,
    p_merchant_wallet TEXT,
    p_signature      TEXT,
    p_claim_token    TEXT,
    p_outcome        TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    v_intent public.agent_payment_intents%ROWTYPE;
    v_row    JSONB;
BEGIN
    -- ---- validation -------------------------------------------------------
    IF p_intent_id IS NULL
       OR p_merchant_wallet IS NULL
       OR length(trim(p_merchant_wallet)) = 0
       OR p_signature IS NULL
       OR p_signature !~ '^[1-9A-HJ-NP-Za-km-z]{64,88}$'
       OR p_claim_token IS NULL THEN
        RETURN jsonb_build_object('outcome', 'invalid_request');
    END IF;

    IF p_outcome NOT IN ('accepted','unknown') THEN
        RETURN jsonb_build_object('outcome', 'invalid_outcome');
    END IF;

    SELECT * INTO v_intent FROM public.agent_payment_intents WHERE id = p_intent_id FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('outcome', 'unknown_intent');
    END IF;

    -- Verify merchant wallet
    IF v_intent.merchant_wallet <> p_merchant_wallet THEN
        RETURN jsonb_build_object('outcome', 'wrong_merchant');
    END IF;

    -- Verify signature matches stored signature
    IF v_intent.transaction_signature != p_signature THEN
        RETURN jsonb_build_object('outcome', 'signature_mismatch');
    END IF;

    -- Verify lease token and claimed state
    IF v_intent.broadcast_lease_token IS DISTINCT FROM p_claim_token
       OR v_intent.broadcast_status != 'claimed' THEN
        RETURN jsonb_build_object('outcome', 'stale_claim_or_no_lease');
    END IF;

    -- Record the outcome and clear the lease atomically.
    -- Do NOT increment broadcast_attempt_count here; claim already incremented it.
    UPDATE public.agent_payment_intents
    SET
        broadcast_status = CASE WHEN p_outcome = 'accepted' THEN 'accepted'
                               ELSE 'unknown' END,
        broadcast_response_at = NOW(),
        broadcast_last_error = NULL,
        broadcast_lease_token = NULL,
        broadcast_lease_expires_at = NULL,
        -- keep attempt count unchanged
        broadcast_attempt_count = v_intent.broadcast_attempt_count,
        broadcast_attempted_at = NOW()
    WHERE id = v_intent.id;

    SELECT to_jsonb(i) INTO v_row FROM public.agent_payment_intents AS i WHERE i.id = v_intent.id;

    RETURN jsonb_build_object(
        'outcome', 'recorded',
        'intent', v_row,
        'broadcast_status', v_intent.broadcast_status,
        'recorded_at', v_row.broadcast_response_at
    );
END;
$$;

REVOKE ALL ON FUNCTION public.record_agent_payment_broadcast (TEXT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_agent_payment_broadcast (TEXT,TEXT,TEXT,TEXT,TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.record_agent_payment_broadcast (TEXT,TEXT,TEXT,TEXT,TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.record_agent_payment_broadcast (TEXT,TEXT,TEXT,TEXT,TEXT) TO service_role;

-- ---------------------------------------------------------------------------
-- 7️⃣  Updated verify_agent_payment_intent
--    – Keeps all Solana RPC and cryptographic verification in the server handler,
--      outside PostgreSQL. The RPC only persists a result already independently
--      verified by the server.
--    – Validates the outcome against the stored fee‑policy snapshot and reason
--      allowlists.
--    – Persists terminal states: verified, verified_fee_exception, failed, manual_review.
--    – Preserves terminal‑state immutability and original verified_at.
--    – Missing evidence or missing fee metadata leaves row pending without modification.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.verify_agent_payment_intent(
    p_nonce          TEXT,
    p_merchant_wallet TEXT,
    p_signature      TEXT,
    p_payer_address  TEXT,
    p_status         TEXT,
    p_meta_fee_lamports TEXT DEFAULT NULL,
    p_failure_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    v_intent public.agent_payment_intents%ROWTYPE;
    v_row    JSONB;
BEGIN
    -- ---- input validation -------------------------------------------------
    IF p_nonce IS NULL
       OR p_nonce !~ '^[a-f0-9]{16,64}$'
       OR p_merchant_wallet IS NULL
       OR length(trim(p_merchant_wallet)) = 0
       OR p_signature IS NULL
       OR p_signature !~ '^[1-9A-HJ-NP-Za-km-z]{64,88}$'
       OR p_payer_address IS NULL
       OR p_payer_address !~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$' THEN
        RETURN jsonb_build_object('outcome', 'invalid_request');
    END IF;

    SELECT * INTO v_intent FROM public.agent_payment_intents WHERE nonce = p_nonce FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('outcome', 'unknown');
    END IF;

    IF v_intent.merchant_wallet <> p_merchant_wallet THEN
        RETURN jsonb_build_object('outcome', 'wrong_merchant');
    END IF;

    ---- terminal‑state shortcut – idempotent repeat -----------------------
    IF v_intent.status IN ('verified','verified_fee_exception','failed','manual_review') THEN
        SELECT to_jsonb(i) INTO v_row FROM public.agent_payment_intents AS i WHERE i.id = v_intent.id;
        RETURN jsonb_build_object('outcome', 'already_terminal', 'intent', v_row);
    END IF;

    IF v_intent.status = 'verified' THEN
        RETURN jsonb_build_object('outcome', 'already_verified');
    END IF;

    IF v_intent.status <> 'submitted' THEN
        RETURN jsonb_build_object('outcome', 'not_submitted');
    END IF;

    IF v_intent.transaction_signature IS DISTINCT FROM p_signature THEN
        RETURN jsonb_build_object('outcome', 'signature_mismatch');
    END IF;

    IF v_intent.payer_address IS DISTINCT FROM p_payer_address THEN
        RETURN jsonb_build_object('outcome', 'payer_mismatch');
    END IF;

    ---- persist the trusted verification result ----------------------------
    CASE p_status
        WHEN 'verified' THEN
            UPDATE public.agent_payment_intents
            SET status = 'verified',
                meta_fee_lamports = p_meta_fee_lamports,
                verified_at = CASE WHEN v_intent.verified_at IS NULL THEN NOW() ELSE v_intent.verified_at END,
                failure_reason = NULL
            WHERE id = v_intent.id;
        WHEN 'verified_fee_exception' THEN
            UPDATE public.agent_payment_intents
            SET status = 'verified_fee_exception',
                meta_fee_lamports = p_meta_fee_lamports,
                verified_at = CASE WHEN v_intent.verified_at IS NULL THEN NOW() ELSE v_intent.verified_at END,
                failure_reason = p_failure_reason
            WHERE id = v_intent.id;
        WHEN 'failed' THEN
            -- Only allow a small allowlisted set of on‑chain execution‑failure reasons.
            IF p_failure_reason IS NOT NULL
               AND length(p_failure_reason) BETWEEN 3 AND 64
               AND p_failure_reason ~ '^[a-z0-9_]+$' THEN
                UPDATE public.agent_payment_intents
                SET status = 'failed',
                    failure_reason = p_failure_reason
                WHERE id = v_intent.id;
            ELSE
                -- Not a legitimate on‑chain failure; keep row as submitted.
                RETURN jsonb_build_object('outcome', 'pending',
                    'pending_reason', 'non‑allowlisted failure reason');
            END IF;
        WHEN 'manual_review' THEN
            UPDATE public.agent_payment_intents
            SET status = 'manual_review',
                failure_reason = p_failure_reason,
                -- preserve the signed transaction and signature
                transaction_base64 = v_intent.transaction_base64,
                transaction_signature = v_intent.transaction_signature
            WHERE id = v_intent.id;
        ELSE
            RETURN jsonb_build_object('outcome', 'invalid_status');
    END CASE;

    SELECT to_jsonb(i) INTO v_row FROM public.agent_payment_intents AS i WHERE i.id = v_intent.id;

    RETURN jsonb_build_object('outcome', 'recorded', 'intent', v_row);
END;
$$;

REVOKE ALL ON FUNCTION public.verify_agent_payment_intent (TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.verify_agent_payment_intent (TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.verify_agent_payment_intent (TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.verify_agent_payment_intent (TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) TO service_role;

-- ---------------------------------------------------------------------------
-- 8️⃣  Lifecycle guards – update existing mutation RPCs
-- ---------------------------------------------------------------------------

-- 8.1 approve_agent_payment_intent – reject terminals, block re‑approval of submitted
CREATE OR REPLACE FUNCTION public.approve_agent_payment_intent(
    p_nonce               TEXT,
    p_merchant_wallet     TEXT,
    p_fingerprint         TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    v_intent public.agent_payment_intents%ROWTYPE;
    v_row    JSONB;
BEGIN
    IF p_nonce IS NULL
       OR p_nonce !~ '^[a-f0-9]{16,64}$'
       OR p_merchant_wallet IS NULL
       OR length(trim(p_merchant_wallet)) = 0
       OR p_fingerprint IS NULL
       OR p_fingerprint !~ '^[a-f0-9]{64}$' THEN
        RETURN jsonb_build_object('outcome', 'invalid_request');
    END IF;

    SELECT * INTO v_intent FROM public.agent_payment_intents WHERE nonce = p_nonce FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('outcome', 'unknown');
    END IF;

    IF v_intent.merchant_wallet <> p_merchant_wallet THEN
        RETURN jsonb_build_object('outcome', 'wrong_merchant');
    END IF;

    -- block approval if intent is already in a terminal state
    IF v_intent.status IN ('verified','verified_fee_exception','failed','manual_review') THEN
        RETURN jsonb_build_object('outcome', 'already_approved');
    END IF;

    -- submitted intents cannot be approved
    IF v_intent.status = 'submitted' THEN
        RETURN jsonb_build_object('outcome', 'not_approved');
    END IF;

    -- existing logic for draft, expired, etc. stays unchanged
    IF v_intent.status IN ('approved','submitted','verified') THEN
        IF v_intent.status = 'approved'
           AND (v_intent.approval_expires_at IS NULL OR v_intent.approval_expires_at <= NOW()) THEN
            UPDATE public.agent_payment_intents
            SET approved_at = COALESCE(approved_at, NOW()),
                approval_expires_at = NOW() + INTERVAL '5 minutes'
            WHERE id = v_intent.id;

            SELECT to_jsonb(i) INTO v_row FROM public.agent_payment_intents AS i WHERE i.id = v_intent.id;
            RETURN jsonb_build_object('outcome', 'approved', 'intent', v_row);
        END IF;

        SELECT to_jsonb(i) INTO v_row FROM public.agent_payment_intents AS i WHERE i.id = v_intent.id;
        RETURN jsonb_build_object('outcome', 'already_approved', 'intent', v_row);
    END IF;

    IF v_intent.status = 'cancelled' THEN
        RETURN jsonb_build_object('outcome', 'revoked');
    END IF;

    IF v_intent.status = 'expired' THEN
        RETURN jsonb_build_object('outcome', 'expired');
    END IF;

    IF v_intent.status <> 'draft' THEN
        RETURN jsonb_build_object('outcome', 'invalid_status', 'status', v_intent.status);
    END IF;

    IF v_intent.expires_at <= NOW() THEN
        UPDATE public.agent_payment_intents SET status = 'expired' WHERE id = v_intent.id;
        RETURN jsonb_build_object('outcome', 'expired');
    END IF;

    UPDATE public.agent_payment_intents SET status = 'approved',
        approved_at = NOW(),
        approval_expires_at = NOW() + INTERVAL '5 minutes' WHERE id = v_intent.id;

    SELECT to_jsonb(i) INTO v_row FROM public.agent_payment_intents AS i WHERE i.id = v_intent.id;
    RETURN jsonb_build_object('outcome', 'approved', 'intent', v_row);
END;
$$;

REVOKE ALL ON FUNCTION public.approve_agent_payment_intent (TEXT,TEXT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.approve_agent_payment_intent (TEXT,TEXT,TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.approve_agent_payment_intent (TEXT,TEXT,TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.approve_agent_payment_intent (TEXT,TEXT,TEXT) TO service_role;

-- 8.2 reauthorize_agent_payment_intent – block terminals
CREATE OR REPLACE FUNCTION public.reauthorize_agent_payment_intent(
    p_nonce               TEXT,
    p_merchant_wallet     TEXT,
    p_new_nonce           TEXT,
    p_new_fingerprint     TEXT,
    p_new_expires_at      TIMESTAMPTZ,
    p_recipient_address   TEXT,
    p_amount_lamports     TEXT,
    p_purpose             TEXT,
    p_source_kind         TEXT,
    p_source_payment_request_reference TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    v_intent public.agent_payment_intents%ROWTYPE;
    v_row    JSONB;
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
       OR p_source_kind NOT IN ('address','payment_request')
       OR (p_source_kind = 'address' AND p_source_payment_request_reference IS NOT NULL)
       OR (p_source_kind = 'payment_request' AND p_source_payment_request_reference IS NULL) THEN
        RETURN jsonb_build_object('outcome', 'invalid_request');
    END IF;

    SELECT * INTO v_intent FROM public.agent_payment_intents WHERE nonce = p_nonce FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('outcome', 'unknown');
    END IF;

    IF v_intent.merchant_wallet <> p_merchant_wallet THEN
        RETURN jsonb_build_object('outcome', 'wrong_merchant');
    END IF;

    -- block re‑authorization of terminal states
    IF v_intent.status IN ('verified','verified_fee_exception','failed','manual_review') THEN
        RETURN jsonb_build_object('outcome', 'already_approved');
    END IF;

    -- submitted/intents that already have a broadcast cannot be re‑authorized
    IF v_intent.status = 'submitted' THEN
        RETURN jsonb_build_object('outcome', 'not_approved');
    END IF;

    -- existing draft logic remains
    IF v_intent.status <> 'draft' THEN
        RETURN jsonb_build_object('outcome', 'invalid_status', 'status', v_intent.status);
    END IF;

    IF v_intent.expires_at <= NOW() THEN
        UPDATE public.agent_payment_intents SET status = 'expired' WHERE id = v_intent.id;
        RETURN jsonb_build_object('outcome', 'expired');
    END IF;

    UPDATE public.agent_payment_intents
    SET nonce = p_new_nonce,
        intent_fingerprint = p_new_fingerprint,
        expires_at = p_new_expires_at,
        recipient_address = p_recipient_address,
        amount_lamports = p_amount_lamports,
        purpose = p_purpose,
        source_kind = p_source_kind,
        source_payment_request_reference = p_source_payment_request_reference
    WHERE id = v_intent.id;

    SELECT to_jsonb(i) INTO v_row FROM public.agent_payment_intents AS i WHERE i.id = v_intent.id;
    RETURN jsonb_build_object('outcome', 'reauthorized', 'intent', v_row);
END;
$$;

REVOKE ALL ON FUNCTION public.reauthorize_agent_payment_intent (TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ,TEXT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reauthorize_agent_payment_intent (TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ,TEXT,TEXT,TEXT,TEXT,TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.reauthorize_agent_payment_intent (TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ,TEXT,TEXT,TEXT,TEXT,TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.reauthorize_agent_payment_intent (TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ,TEXT,TEXT,TEXT,TEXT,TEXT) TO service_role;

-- 8.3 revoke_agent_payment_intent – block terminals
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

    SELECT * INTO v_intent FROM public.agent_payment_intents WHERE nonce = p_nonce FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('outcome', 'unknown');
    END IF;

    IF v_intent.merchant_wallet <> p_merchant_wallet THEN
        RETURN jsonb_build_object('outcome', 'wrong_merchant');
    END IF;

    -- block revocation of terminal states
    IF v_intent.status IN ('verified','verified_fee_exception','failed','manual_review') THEN
        RETURN jsonb_build_object('outcome', 'cannot_revoke_terminal');
    END IF;

    -- existing draft/approved/cancel logic stays
    IF v_intent.status = 'cancelled' THEN
        RETURN jsonb_build_object('outcome', 'revoked');
    END IF;

    IF v_intent.status = 'expired' THEN
        RETURN jsonb_build_object('outcome', 'expired');
    END IF;

    IF v_intent.status NOT IN ('draft','approved') THEN
        RETURN jsonb_build_object('outcome', 'invalid_status', 'status', v_intent.status);
    END IF;

    IF v_intent.status = 'draft' AND v_intent.expires_at <= NOW() THEN
        UPDATE public.agent_payment_intents SET status = 'expired' WHERE id = v_intent.id;
        RETURN jsonb_build_object('outcome', 'expired');
    END IF;

    UPDATE public.agent_payment_intents SET status = 'cancelled' WHERE id = v_intent.id;
    RETURN jsonb_build_object('outcome', 'revoked');
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_agent_payment_intent (TEXT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.revoke_agent_payment_intent (TEXT,TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.revoke_agent_payment_intent (TEXT,TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_agent_payment_intent (TEXT,TEXT) TO service_role;

-- ---------------------------------------------------------------------------
-- 9️⃣  Security: revoke execution from PUBLIC/anon/authenticated, grant only to service_role
--    (already done for each function above; this comment block records the intent.)
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- End of migration
-- ---------------------------------------------------------------------------

COMMENT ON COLUMN public.agent_payment_intents.transaction_base64 IS
    'Exact signed transaction bytes (base64), stored after submit_agent_payment_intent';
COMMENT ON COLUMN public.agent_payment_intents.broadcast_status IS
    'Current broadcast state: pending | claimed | accepted | unknown';
COMMENT ON COLUMN public.agent_payment_intents.broadcast_attempt_count IS
    'Number of broadcast attempt attempts';
COMMENT ON COLUMN public.agent_payment_intents.broadcast_attempted_at IS
    'Timestamp of the most recent broadcast attempt';
COMMENT ON COLUMN public.agent_payment_intents.broadcast_response_at IS
    'Timestamp when the broadcast response was recorded (accepted/unknown)';
COMMENT ON COLUMN public.agent_payment_intents.broadcast_lease_token IS
    'Lease token used by claim_agent_payment_broadcast / record_agent_payment_broadcast';
COMMENT ON COLUMN public.agent_payment_intents.broadcast_lease_expires_at IS
    'Expiry time of the active lease';
COMMENT ON COLUMN public.agent_payment_intents.broadcast_last_error IS
    'Last error string from a broadcast attempt';
COMMENT ON COLUMN public.agent_payment_intents.meta_fee_lamports IS
    'Actual on‑chain meta.fee in lamports, populated only by verification';