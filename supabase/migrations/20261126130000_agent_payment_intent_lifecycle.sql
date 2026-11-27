-- Migration: authoritative agent payment intent lifecycle
--
-- Purpose (Stage 4 Step 1 — no transaction is built, signed or submitted here):
--   1. Record when an approval happened and when it stops being usable.
--   2. Record the submitted transaction signature and payer atomically, once.
--   3. Record successful verification only for the exact submitted signature.
--   4. Record a definitive transaction failure without overwriting a settlement.
--   5. Allow an approved-but-unsigned intent to be cancelled.
--
-- It is additive and safe to re-run:
--   * new columns use ADD COLUMN IF NOT EXISTS;
--   * backfills only touch rows whose new columns are still NULL;
--   * constraints are added inside existence checks;
--   * functions use CREATE OR REPLACE with their existing signatures.
-- No existing column, constraint, index, policy or grant is dropped, and no row
-- is deleted. amount_lamports stays TEXT and is only ever compared as bigint.
--
-- Lifecycle (every transition is one locked transaction):
--   draft                    -> approved   (approve_agent_payment_intent)
--   approved                 -> cancelled  (revoke_agent_payment_intent)
--   draft                    -> cancelled  (revoke_agent_payment_intent)
--   draft (past expires_at)  -> expired    (approve / reauthorize / revoke)
--   approved                 -> submitted  (submit_agent_payment_intent)
--   submitted                -> verified   (verify_agent_payment_intent)
--   submitted                -> failed     (fail_agent_payment_intent)
--
-- Explicitly NOT implemented:
--   * approved/submitted/verified -> draft or back
--   * submitted -> cancelled   (a broadcast payment cannot be un-sent)
--   * verified -> failed       (a settlement is final)
--   * expired  -> approved     (an expired draft must be prepared again)
--   * re-approval of submitted/verified rows (idempotent read only)
--   * any function that takes a status value from the caller
--
-- Approval window: an approval is usable for 5 minutes. It is independent of the
-- intent's own expires_at (the token TTL), so a merchant who approves at minute 9
-- of a 10-minute intent still has time to sign. Re-approving an approved but
-- unsigned intent after the window rotates only the window — never the nonce,
-- reference or intent identity — so no second authorization is created.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Lifecycle columns
-- ---------------------------------------------------------------------------

ALTER TABLE public.agent_payment_intents
    ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS approval_expires_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS failure_reason TEXT;

-- Legacy approved/submitted/verified rows predate this migration. They are
-- backfilled fail-closed: an already-approved row gets an approval window that
-- has already elapsed, so it cannot be submitted until it is approved again.
UPDATE public.agent_payment_intents
SET
    approved_at = COALESCE(approved_at, created_at),
    approval_expires_at = COALESCE(
        approval_expires_at,
        GREATEST(created_at + INTERVAL '1 second', NOW())
    )
WHERE status IN ('approved', 'submitted', 'verified')
  AND (approved_at IS NULL OR approval_expires_at IS NULL);

UPDATE public.agent_payment_intents
SET submitted_at = COALESCE(
        submitted_at,
        verified_at,
        created_at + INTERVAL '1 second'
    )
WHERE status IN ('submitted', 'verified')
  AND submitted_at IS NULL;

-- Normalise rows that only carry one of the two approval timestamps (possible
-- only through manual edits). This keeps the ordering constraint below from
-- failing on data the migration did not create.
UPDATE public.agent_payment_intents
SET approval_expires_at = approved_at + INTERVAL '5 minutes'
WHERE approved_at IS NOT NULL
  AND approval_expires_at IS NULL;

UPDATE public.agent_payment_intents
SET approved_at = approval_expires_at - INTERVAL '5 minutes'
WHERE approval_expires_at IS NOT NULL
  AND approved_at IS NULL;

UPDATE public.agent_payment_intents
SET approval_expires_at = approved_at + INTERVAL '5 minutes'
WHERE approved_at IS NOT NULL
  AND approval_expires_at IS NOT NULL
  AND approval_expires_at <= approved_at;

-- Pre-existing failed rows have no reason recorded; label them as legacy rather
-- than blocking the additive constraint add.
UPDATE public.agent_payment_intents
SET failure_reason = 'legacy_failure'
WHERE status = 'failed'
  AND failure_reason IS NULL;

-- Constraints are added conditionally so re-running the migration is a no-op.
DO $$
BEGIN
    -- An approved, submitted or verified row always carries a bounded approval.
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'agent_intent_approved_consistency'
          AND conrelid = 'public.agent_payment_intents'::regclass
    ) THEN
        ALTER TABLE public.agent_payment_intents
            ADD CONSTRAINT agent_intent_approved_consistency
            CHECK (
                status NOT IN ('approved', 'submitted', 'verified')
                OR (approved_at IS NOT NULL AND approval_expires_at IS NOT NULL)
            );
    END IF;

    -- The two lifecycle timestamps are either both absent or both ordered.
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'agent_intent_approval_window_valid'
          AND conrelid = 'public.agent_payment_intents'::regclass
    ) THEN
        ALTER TABLE public.agent_payment_intents
            ADD CONSTRAINT agent_intent_approval_window_valid
            CHECK (
                (approved_at IS NULL AND approval_expires_at IS NULL)
                OR (
                    approved_at IS NOT NULL
                    AND approval_expires_at IS NOT NULL
                    AND approval_expires_at > approved_at
                )
            );
    END IF;

    -- Submission is only meaningful with the time it was recorded. The
    -- signature itself is required by the submit RPC and, for verified rows, by
    -- the pre-existing agent_intent_verified_consistency constraint. It is not
    -- re-required here so a legacy row can never block the additive migration.
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'agent_intent_submitted_consistency'
          AND conrelid = 'public.agent_payment_intents'::regclass
    ) THEN
        ALTER TABLE public.agent_payment_intents
            ADD CONSTRAINT agent_intent_submitted_consistency
            CHECK (
                status NOT IN ('submitted', 'verified')
                OR submitted_at IS NOT NULL
            );
    END IF;

    -- A failed row must say why, with a short machine-readable reason.
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'agent_intent_failure_consistency'
          AND conrelid = 'public.agent_payment_intents'::regclass
    ) THEN
        ALTER TABLE public.agent_payment_intents
            ADD CONSTRAINT agent_intent_failure_consistency
            CHECK (
                status <> 'failed'
                OR (
                    failure_reason IS NOT NULL
                    AND length(failure_reason) BETWEEN 3 AND 64
                )
            );
    END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. Approval: extend the existing function with the approval window
--
-- The signature, ownership and fingerprint checks are unchanged. What is new:
--   * draft -> approved also writes approved_at and approval_expires_at;
--   * approved with a live window        -> already_approved (idempotent);
--   * approved with an elapsed window    -> refresh only the window, 'approved';
--   * submitted / verified               -> already_approved (never re-approved);
--   * cancelled -> revoked, expired -> expired, rejected/failed -> invalid_status.
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
        -- A live approval window is idempotent. An elapsed window on an
        -- unsigned intent refreshes only the window: same row, same nonce,
        -- same reference, so no second authorization exists.
        IF v_intent.status = 'approved'
           AND (
               v_intent.approval_expires_at IS NULL
               OR v_intent.approval_expires_at <= NOW()
           ) THEN
            UPDATE public.agent_payment_intents
            SET
                approved_at = COALESCE(approved_at, NOW()),
                approval_expires_at = NOW() + INTERVAL '5 minutes'
            WHERE id = v_intent.id;

            SELECT to_jsonb(i)
            INTO v_row
            FROM public.agent_payment_intents AS i
            WHERE i.id = v_intent.id;

            RETURN jsonb_build_object(
                'outcome', 'approved',
                'intent', v_row
            );
        END IF;

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
    SET
        status = 'approved',
        approved_at = NOW(),
        approval_expires_at = NOW() + INTERVAL '5 minutes'
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
-- 3. Revocation: allow cancelling an approved but unsigned intent
--
--   draft / approved -> cancelled, 'revoked'
--   cancelled        -> 'revoked'   (idempotent)
--   expired          -> 'expired'   (never silently revived)
--   submitted / verified -> 'approved' (a broadcast or settled payment cannot
--                          be un-sent, so cancellation must never touch it)
--   rejected / failed -> invalid_status
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

    IF v_intent.status IN ('submitted', 'verified') THEN
        RETURN jsonb_build_object('outcome', 'approved');
    END IF;

    IF v_intent.status = 'cancelled' THEN
        RETURN jsonb_build_object('outcome', 'revoked');
    END IF;

    IF v_intent.status = 'expired' THEN
        RETURN jsonb_build_object('outcome', 'expired');
    END IF;

    IF v_intent.status NOT IN ('draft', 'approved') THEN
        RETURN jsonb_build_object(
            'outcome', 'invalid_status',
            'status', v_intent.status
        );
    END IF;

    IF v_intent.status = 'draft' AND v_intent.expires_at <= NOW() THEN
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

-- ---------------------------------------------------------------------------
-- 4. Submission: approved -> submitted, exactly once per signature
--
--   approved (window live)          -> submitted, 'submitted'
--   submitted, same signature       -> 'already_submitted' (idempotent retry)
--   submitted, different signature  -> 'signature_conflict'
--   verified                        -> 'already_verified'
--   approved, window elapsed        -> 'approval_expired' (row unchanged; a
--                                      re-approval refreshes the window)
--   draft / cancelled / expired / failed -> 'not_approved' / 'invalid_status'
--
-- A signature already attached to another intent is refused by the partial
-- unique index; the violation is reported as 'signature_conflict' instead of
-- raising.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.submit_agent_payment_intent(
    p_nonce TEXT,
    p_merchant_wallet TEXT,
    p_signature TEXT,
    p_payer_address TEXT
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
       OR p_signature IS NULL
       OR p_signature !~ '^[1-9A-HJ-NP-Za-km-z]{64,88}$'
       OR p_payer_address IS NULL
       OR p_payer_address !~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'
       OR p_payer_address <> p_merchant_wallet THEN
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

    IF v_intent.status = 'submitted' THEN
        IF v_intent.transaction_signature = p_signature THEN
            SELECT to_jsonb(i)
            INTO v_row
            FROM public.agent_payment_intents AS i
            WHERE i.id = v_intent.id;

            RETURN jsonb_build_object(
                'outcome', 'already_submitted',
                'intent', v_row
            );
        END IF;

        RETURN jsonb_build_object('outcome', 'signature_conflict');
    END IF;

    IF v_intent.status = 'verified' THEN
        RETURN jsonb_build_object('outcome', 'already_verified');
    END IF;

    IF v_intent.status = 'cancelled' OR v_intent.status = 'expired' THEN
        RETURN jsonb_build_object('outcome', 'invalid_status');
    END IF;

    IF v_intent.status <> 'approved' THEN
        RETURN jsonb_build_object('outcome', 'not_approved');
    END IF;

    IF v_intent.approval_expires_at IS NULL
       OR v_intent.approval_expires_at <= NOW() THEN
        -- The row stays approved: re-approval refreshes only the window.
        RETURN jsonb_build_object('outcome', 'approval_expired');
    END IF;

    BEGIN
        UPDATE public.agent_payment_intents
        SET
            status = 'submitted',
            transaction_signature = p_signature,
            payer_address = p_payer_address,
            submitted_at = NOW()
        WHERE id = v_intent.id;
    EXCEPTION
        WHEN unique_violation THEN
            RETURN jsonb_build_object('outcome', 'signature_conflict');
    END;

    SELECT to_jsonb(i)
    INTO v_row
    FROM public.agent_payment_intents AS i
    WHERE i.id = v_intent.id;

    RETURN jsonb_build_object(
        'outcome', 'submitted',
        'intent', v_row
    );
END;
$$;

REVOKE ALL ON FUNCTION public.submit_agent_payment_intent(
    TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_agent_payment_intent(
    TEXT, TEXT, TEXT, TEXT
) FROM anon;
REVOKE ALL ON FUNCTION public.submit_agent_payment_intent(
    TEXT, TEXT, TEXT, TEXT
) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.submit_agent_payment_intent(
    TEXT, TEXT, TEXT, TEXT
) TO service_role;

-- ---------------------------------------------------------------------------
-- 5. Verification: submitted -> verified for the recorded signature only
--
--   submitted, same signature + payer   -> verified   (verified_at = NOW())
--   verified, same signature + payer    -> 'already_verified'
--   verified, different signature/payer -> 'signature_conflict'
--   not submitted                       -> 'not_submitted'
--   submitted, different signature      -> 'signature_mismatch'
--   submitted, different payer          -> 'payer_mismatch'
--
-- verified_at is written by the database, never supplied by the caller, so a
-- verification time cannot be back-dated or forged from the API layer.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.verify_agent_payment_intent(
    p_nonce TEXT,
    p_merchant_wallet TEXT,
    p_signature TEXT,
    p_payer_address TEXT
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
       OR p_signature IS NULL
       OR p_signature !~ '^[1-9A-HJ-NP-Za-km-z]{64,88}$'
       OR p_payer_address IS NULL
       OR p_payer_address !~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$' THEN
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

    IF v_intent.status = 'verified' THEN
        IF v_intent.transaction_signature = p_signature
           AND v_intent.payer_address = p_payer_address THEN
            SELECT to_jsonb(i)
            INTO v_row
            FROM public.agent_payment_intents AS i
            WHERE i.id = v_intent.id;

            RETURN jsonb_build_object(
                'outcome', 'already_verified',
                'intent', v_row
            );
        END IF;

        RETURN jsonb_build_object('outcome', 'signature_conflict');
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

    UPDATE public.agent_payment_intents
    SET
        status = 'verified',
        verified_at = NOW(),
        failure_reason = NULL
    WHERE id = v_intent.id;

    SELECT to_jsonb(i)
    INTO v_row
    FROM public.agent_payment_intents AS i
    WHERE i.id = v_intent.id;

    RETURN jsonb_build_object(
        'outcome', 'verified',
        'intent', v_row
    );
END;
$$;

REVOKE ALL ON FUNCTION public.verify_agent_payment_intent(
    TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.verify_agent_payment_intent(
    TEXT, TEXT, TEXT, TEXT
) FROM anon;
REVOKE ALL ON FUNCTION public.verify_agent_payment_intent(
    TEXT, TEXT, TEXT, TEXT
) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.verify_agent_payment_intent(
    TEXT, TEXT, TEXT, TEXT
) TO service_role;

-- ---------------------------------------------------------------------------
-- 6. Definitive failure: submitted -> failed for the recorded signature only
--
--   submitted, same signature -> failed, 'failed'
--   failed, same signature + reason -> 'already_failed' (idempotent)
--   verified                  -> 'already_verified' (a settlement is final)
--   approved / draft          -> 'not_submitted' (nothing was broadcast; a
--                                timeout or wallet rejection must never land
--                                here)
--   submitted, other signature -> 'signature_mismatch'
--
-- The reason is a bounded machine-readable code. Callers may only pass a
-- definitive on-chain failure; network/RPC timeouts keep the intent submitted
-- so verification can be retried.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fail_agent_payment_intent(
    p_nonce TEXT,
    p_merchant_wallet TEXT,
    p_signature TEXT,
    p_reason TEXT
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
       OR p_signature IS NULL
       OR p_signature !~ '^[1-9A-HJ-NP-Za-km-z]{64,88}$'
       OR p_reason IS NULL
       OR length(p_reason) < 3
       OR length(p_reason) > 64
       OR p_reason !~ '^[a-z0-9_]+$' THEN
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

    IF v_intent.status = 'verified' THEN
        RETURN jsonb_build_object('outcome', 'already_verified');
    END IF;

    IF v_intent.status = 'failed' THEN
        IF v_intent.transaction_signature = p_signature THEN
            SELECT to_jsonb(i)
            INTO v_row
            FROM public.agent_payment_intents AS i
            WHERE i.id = v_intent.id;

            RETURN jsonb_build_object(
                'outcome', 'already_failed',
                'intent', v_row
            );
        END IF;

        RETURN jsonb_build_object('outcome', 'signature_mismatch');
    END IF;

    IF v_intent.status <> 'submitted' THEN
        RETURN jsonb_build_object('outcome', 'not_submitted');
    END IF;

    IF v_intent.transaction_signature IS DISTINCT FROM p_signature THEN
        RETURN jsonb_build_object('outcome', 'signature_mismatch');
    END IF;

    UPDATE public.agent_payment_intents
    SET
        status = 'failed',
        failure_reason = p_reason
    WHERE id = v_intent.id;

    SELECT to_jsonb(i)
    INTO v_row
    FROM public.agent_payment_intents AS i
    WHERE i.id = v_intent.id;

    RETURN jsonb_build_object(
        'outcome', 'failed',
        'intent', v_row
    );
END;
$$;

REVOKE ALL ON FUNCTION public.fail_agent_payment_intent(
    TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fail_agent_payment_intent(
    TEXT, TEXT, TEXT, TEXT
) FROM anon;
REVOKE ALL ON FUNCTION public.fail_agent_payment_intent(
    TEXT, TEXT, TEXT, TEXT
) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.fail_agent_payment_intent(
    TEXT, TEXT, TEXT, TEXT
) TO service_role;

COMMENT ON COLUMN public.agent_payment_intents.approved_at IS
    'When the merchant approved this intent; written by approve_agent_payment_intent.';

COMMENT ON COLUMN public.agent_payment_intents.approval_expires_at IS
    'End of the signing window opened by the latest approval (5 minutes). Submission is refused after it.';

COMMENT ON COLUMN public.agent_payment_intents.submitted_at IS
    'When the broadcast transaction signature was recorded; written by submit_agent_payment_intent.';

COMMENT ON COLUMN public.agent_payment_intents.failure_reason IS
    'Bounded machine-readable reason for a definitive on-chain transaction failure.';

COMMENT ON FUNCTION public.submit_agent_payment_intent(TEXT, TEXT, TEXT, TEXT) IS
    'Records the single submitted signature and payer for an approved intent. Idempotent for the same signature.';

COMMENT ON FUNCTION public.verify_agent_payment_intent(TEXT, TEXT, TEXT, TEXT) IS
    'Marks the submitted transaction verified for the exact recorded signature and payer. Sets verified_at = NOW().';

COMMENT ON FUNCTION public.fail_agent_payment_intent(TEXT, TEXT, TEXT, TEXT) IS
    'Marks a submitted transaction as definitively failed, without touching a verified settlement.';

COMMIT;
