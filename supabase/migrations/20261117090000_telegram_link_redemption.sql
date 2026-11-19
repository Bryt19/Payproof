
-- ============================================================================
-- PayProof: Telegram account linking
-- Migration: 20261117090000_telegram_link_redemption.sql
-- Stage 4.3A Step 2: Telegram token redemption and link tables
--
-- Production schema reference:
--   public.telegram_link_tokens
--   public.telegram_links
--   public.redeem_telegram_token(text, bigint, bigint, text)
--
-- Safety:
--   * Does not drop tables, indexes, constraints, or functions.
--   * Does not delete or update existing records.
--   * Adds missing redemption identity columns as nullable columns.
--   * Stops if required existing table structure is incompatible.
--   * Uses the production index and constraint names.
--   * Keeps both production identity CHECK constraints.
--   * Uses a nested exception block for atomic token consumption.
--   * Grants RPC execution to service_role only.
--
-- IMPORTANT:
--   Do not run against production until the migration has been validated
--   against a scratch database and compared with the live schema.
-- ============================================================================


-- ============================================================================
-- 1. CREATE TABLES
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.telegram_link_tokens (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    merchant_wallet_address TEXT NOT NULL,
    token_hash TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ NULL,
    revoked_at TIMESTAMPTZ NULL,
    redeemed_telegram_user_id BIGINT NULL,
    redeemed_telegram_chat_id BIGINT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT telegram_link_tokens_pkey
        PRIMARY KEY (id),

    CONSTRAINT telegram_link_tokens_token_hash_key
        UNIQUE (token_hash),

    CONSTRAINT telegram_link_tokens_positive_expiry
        CHECK (expires_at > created_at),

    CONSTRAINT telegram_link_tokens_redeemed_identity
        CHECK (
            (
                consumed_at IS NULL
                AND redeemed_telegram_user_id IS NULL
                AND redeemed_telegram_chat_id IS NULL
            )
            OR
            (
                consumed_at IS NOT NULL
                AND redeemed_telegram_user_id IS NOT NULL
                AND redeemed_telegram_chat_id IS NOT NULL
            )
        ),

    CONSTRAINT telegram_link_tokens_redemption_identity_check
        CHECK (
            (
                consumed_at IS NULL
                AND redeemed_telegram_user_id IS NULL
                AND redeemed_telegram_chat_id IS NULL
            )
            OR
            (
                consumed_at IS NOT NULL
                AND redeemed_telegram_user_id IS NOT NULL
                AND redeemed_telegram_chat_id IS NOT NULL
            )
        ),

    CONSTRAINT telegram_link_tokens_token_hash_is_sha256_hex
        CHECK (token_hash ~ '^[0-9a-f]{64}$')
);


CREATE TABLE IF NOT EXISTS public.telegram_links (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    merchant_wallet_address TEXT NOT NULL,
    telegram_user_id BIGINT NOT NULL,
    telegram_chat_id BIGINT NOT NULL,
    telegram_username TEXT NULL,
    linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    unlinked_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT telegram_links_pkey
        PRIMARY KEY (id),

    CONSTRAINT telegram_links_positive_chat
        CHECK (telegram_chat_id > 0),

    CONSTRAINT telegram_links_positive_user
        CHECK (telegram_user_id > 0)
);


-- ============================================================================
-- 2. ADD REDEMPTION IDENTITY COLUMNS TO AN EXISTING TOKEN TABLE
--
-- These columns are nullable so existing unused tokens remain valid.
-- No existing token records are rewritten by this migration.
-- ============================================================================

ALTER TABLE public.telegram_link_tokens
    ADD COLUMN IF NOT EXISTS redeemed_telegram_user_id BIGINT NULL;

ALTER TABLE public.telegram_link_tokens
    ADD COLUMN IF NOT EXISTS redeemed_telegram_chat_id BIGINT NULL;


-- ============================================================================
-- 3. VALIDATE REQUIRED TABLE STRUCTURE
--
-- Do not guess the type or invent a replacement for a missing required column.
-- If an existing table is incompatible, stop and require manual remediation.
-- ============================================================================

DO $$
DECLARE
    v_missing TEXT;
BEGIN
    SELECT string_agg(required.column_name, ', ')
    INTO v_missing
    FROM (
        VALUES
            ('telegram_link_tokens', 'id'),
            ('telegram_link_tokens', 'merchant_wallet_address'),
            ('telegram_link_tokens', 'token_hash'),
            ('telegram_link_tokens', 'expires_at'),
            ('telegram_link_tokens', 'consumed_at'),
            ('telegram_link_tokens', 'revoked_at'),
            ('telegram_link_tokens', 'redeemed_telegram_user_id'),
            ('telegram_link_tokens', 'redeemed_telegram_chat_id'),
            ('telegram_link_tokens', 'created_at'),
            ('telegram_links', 'id'),
            ('telegram_links', 'merchant_wallet_address'),
            ('telegram_links', 'telegram_user_id'),
            ('telegram_links', 'telegram_chat_id'),
            ('telegram_links', 'telegram_username'),
            ('telegram_links', 'linked_at'),
            ('telegram_links', 'unlinked_at'),
            ('telegram_links', 'created_at')
    ) AS required(table_name, column_name)
    WHERE NOT EXISTS (
        SELECT 1
        FROM information_schema.columns c
        WHERE c.table_schema = 'public'
          AND c.table_name = required.table_name
          AND c.column_name = required.column_name
    );

    IF v_missing IS NOT NULL THEN
        RAISE EXCEPTION
            'Telegram migration stopped. Required columns are missing: %',
            v_missing;
    END IF;

    -- Verify the UUID identifiers have the expected data type.
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name IN ('telegram_link_tokens', 'telegram_links')
          AND column_name = 'id'
          AND udt_name <> 'uuid'
    ) THEN
        RAISE EXCEPTION
            'Telegram migration stopped. Both table id columns must be UUID.';
    END IF;

    -- Existing IDs must not contain NULL values.
    IF EXISTS (
        SELECT 1 FROM public.telegram_link_tokens WHERE id IS NULL
    ) OR EXISTS (
        SELECT 1 FROM public.telegram_links WHERE id IS NULL
    ) THEN
        RAISE EXCEPTION
            'Telegram migration stopped. Existing Telegram records contain NULL IDs.';
    END IF;

    -- Verify that IDs are unique before relying on them as primary identifiers.
    IF EXISTS (
        SELECT id
        FROM public.telegram_link_tokens
        GROUP BY id
        HAVING count(*) > 1
    ) OR EXISTS (
        SELECT id
        FROM public.telegram_links
        GROUP BY id
        HAVING count(*) > 1
    ) THEN
        RAISE EXCEPTION
            'Telegram migration stopped. Duplicate UUID identifiers were found.';
    END IF;
END;
$$;


-- ============================================================================
-- 4. ENSURE REQUIRED DEFAULTS
-- ============================================================================

ALTER TABLE public.telegram_link_tokens
    ALTER COLUMN id SET DEFAULT gen_random_uuid();

ALTER TABLE public.telegram_link_tokens
    ALTER COLUMN created_at SET DEFAULT now();

ALTER TABLE public.telegram_links
    ALTER COLUMN id SET DEFAULT gen_random_uuid();

ALTER TABLE public.telegram_links
    ALTER COLUMN linked_at SET DEFAULT now();

ALTER TABLE public.telegram_links
    ALTER COLUMN created_at SET DEFAULT now();


-- ============================================================================
-- 5. ENSURE REQUIRED CONSTRAINTS
--
-- Existing production constraint names are preserved.
-- Existing data that violates a required constraint causes the migration
-- to stop instead of being modified.
-- ============================================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.telegram_link_tokens'::regclass
          AND conname = 'telegram_link_tokens_pkey'
    ) THEN
        ALTER TABLE public.telegram_link_tokens
            ADD CONSTRAINT telegram_link_tokens_pkey PRIMARY KEY (id);
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.telegram_link_tokens'::regclass
          AND conname = 'telegram_link_tokens_token_hash_key'
    ) THEN
        ALTER TABLE public.telegram_link_tokens
            ADD CONSTRAINT telegram_link_tokens_token_hash_key
            UNIQUE (token_hash);
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.telegram_link_tokens'::regclass
          AND conname = 'telegram_link_tokens_positive_expiry'
    ) THEN
        ALTER TABLE public.telegram_link_tokens
            ADD CONSTRAINT telegram_link_tokens_positive_expiry
            CHECK (expires_at > created_at);
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.telegram_link_tokens'::regclass
          AND conname = 'telegram_link_tokens_redeemed_identity'
    ) THEN
        ALTER TABLE public.telegram_link_tokens
            ADD CONSTRAINT telegram_link_tokens_redeemed_identity
            CHECK (
                (
                    consumed_at IS NULL
                    AND redeemed_telegram_user_id IS NULL
                    AND redeemed_telegram_chat_id IS NULL
                )
                OR
                (
                    consumed_at IS NOT NULL
                    AND redeemed_telegram_user_id IS NOT NULL
                    AND redeemed_telegram_chat_id IS NOT NULL
                )
            );
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.telegram_link_tokens'::regclass
          AND conname = 'telegram_link_tokens_redemption_identity_check'
    ) THEN
        ALTER TABLE public.telegram_link_tokens
            ADD CONSTRAINT telegram_link_tokens_redemption_identity_check
            CHECK (
                (
                    consumed_at IS NULL
                    AND redeemed_telegram_user_id IS NULL
                    AND redeemed_telegram_chat_id IS NULL
                )
                OR
                (
                    consumed_at IS NOT NULL
                    AND redeemed_telegram_user_id IS NOT NULL
                    AND redeemed_telegram_chat_id IS NOT NULL
                )
            );
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.telegram_link_tokens'::regclass
          AND conname = 'telegram_link_tokens_token_hash_is_sha256_hex'
    ) THEN
        ALTER TABLE public.telegram_link_tokens
            ADD CONSTRAINT telegram_link_tokens_token_hash_is_sha256_hex
            CHECK (token_hash ~ '^[0-9a-f]{64}$');
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.telegram_links'::regclass
          AND conname = 'telegram_links_pkey'
    ) THEN
        ALTER TABLE public.telegram_links
            ADD CONSTRAINT telegram_links_pkey PRIMARY KEY (id);
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.telegram_links'::regclass
          AND conname = 'telegram_links_positive_chat'
    ) THEN
        ALTER TABLE public.telegram_links
            ADD CONSTRAINT telegram_links_positive_chat
            CHECK (telegram_chat_id > 0);
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.telegram_links'::regclass
          AND conname = 'telegram_links_positive_user'
    ) THEN
        ALTER TABLE public.telegram_links
            ADD CONSTRAINT telegram_links_positive_user
            CHECK (telegram_user_id > 0);
    END IF;
END;
$$;


-- ============================================================================
-- 6. CREATE PRODUCTION INDEXES
--
-- These names and predicates match the verified live database.
-- No time-dependent expression is used in an index predicate.
-- ============================================================================

-- One pending, non-revoked token per merchant.
CREATE UNIQUE INDEX IF NOT EXISTS
    telegram_link_tokens_one_pending_per_merchant
ON public.telegram_link_tokens (merchant_wallet_address)
WHERE consumed_at IS NULL
  AND revoked_at IS NULL;

-- Token lookup and expiry indexes.
CREATE INDEX IF NOT EXISTS
    telegram_link_tokens_expiry_idx
ON public.telegram_link_tokens (expires_at);

CREATE INDEX IF NOT EXISTS
    telegram_link_tokens_merchant_idx
ON public.telegram_link_tokens (merchant_wallet_address);

-- One active Telegram link per merchant.
CREATE UNIQUE INDEX IF NOT EXISTS
    telegram_links_one_active_per_merchant
ON public.telegram_links (merchant_wallet_address)
WHERE unlinked_at IS NULL;

-- One active Telegram link per Telegram user.
CREATE UNIQUE INDEX IF NOT EXISTS
    telegram_links_one_active_per_user
ON public.telegram_links (telegram_user_id)
WHERE unlinked_at IS NULL;

-- Telegram link lookup indexes.
CREATE INDEX IF NOT EXISTS
    telegram_links_merchant_lookup_idx
ON public.telegram_links (merchant_wallet_address);

CREATE INDEX IF NOT EXISTS
    telegram_links_telegram_chat_lookup_idx
ON public.telegram_links (telegram_chat_id);


-- ============================================================================
-- 7. ENABLE RLS AND SET TABLE PRIVILEGES
--
-- No browser-role policies are created.
-- Server-side access is through service_role.
-- ============================================================================

ALTER TABLE public.telegram_link_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telegram_links ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES
ON TABLE public.telegram_link_tokens
FROM PUBLIC, anon, authenticated;

REVOKE ALL PRIVILEGES
ON TABLE public.telegram_links
FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE
ON TABLE public.telegram_link_tokens
TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE
ON TABLE public.telegram_links
TO service_role;


-- ============================================================================
-- 8. DOCUMENT TABLES AND IMPORTANT COLUMNS
-- ============================================================================

COMMENT ON TABLE public.telegram_link_tokens IS
    'One-time-use Telegram linking tokens. Only SHA-256 hashes are stored.';

COMMENT ON COLUMN public.telegram_link_tokens.merchant_wallet_address IS
    'Solana wallet address belonging to the merchant who generated the token.';

COMMENT ON COLUMN public.telegram_link_tokens.token_hash IS
    'SHA-256 hexadecimal digest of the raw Telegram linking token.';

COMMENT ON COLUMN public.telegram_link_tokens.expires_at IS
    'Expiry timestamp for the one-time linking token.';

COMMENT ON COLUMN public.telegram_link_tokens.consumed_at IS
    'Timestamp when the token was successfully redeemed.';

COMMENT ON COLUMN public.telegram_link_tokens.redeemed_telegram_user_id IS
    'Telegram user ID that successfully redeemed the token.';

COMMENT ON COLUMN public.telegram_link_tokens.redeemed_telegram_chat_id IS
    'Telegram chat ID that successfully redeemed the token.';

COMMENT ON TABLE public.telegram_links IS
    'Merchant-to-Telegram associations. Unlinked records are retained as history.';

COMMENT ON COLUMN public.telegram_links.telegram_user_id IS
    'Authoritative Telegram user ID.';

COMMENT ON COLUMN public.telegram_links.telegram_chat_id IS
    'Telegram chat ID where the bot is active.';

COMMENT ON COLUMN public.telegram_links.telegram_username IS
    'Optional Telegram username captured when the account was linked.';

COMMENT ON COLUMN public.telegram_links.linked_at IS
    'Timestamp when the Telegram account was linked.';

COMMENT ON COLUMN public.telegram_links.unlinked_at IS
    'NULL indicates an active link. A timestamp indicates a soft-unlinked record.';


-- ============================================================================
-- 9. ATOMIC TELEGRAM TOKEN REDEMPTION
--
-- SECURITY INVOKER:
--   The calling role must have the required table privileges.
--   Execution is granted to service_role only below.
--
-- Redemption rules:
--   1. Validate the supplied hash and Telegram IDs.
--   2. Lock the matching token row.
--   3. Check revoked status before consumed status.
--   4. Return already_redeemed only when the stored Telegram identity matches.
--   5. Check expiry using <= now().
--   6. Check active merchant and Telegram-user links.
--   7. Consume the token and insert the link in a nested subtransaction.
--   8. Roll back consumption if the link insert encounters a uniqueness race.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.redeem_telegram_token(
    p_token_hash TEXT,
    p_telegram_user_id BIGINT,
    p_telegram_chat_id BIGINT,
    p_telegram_username TEXT DEFAULT NULL
)
RETURNS TABLE (
    status TEXT,
    detail TEXT
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
    v_token public.telegram_link_tokens%ROWTYPE;
    v_rows_updated INTEGER;
BEGIN
    -- ------------------------------------------------------------------------
    -- 1. Validate input.
    -- ------------------------------------------------------------------------

    IF p_token_hash IS NULL
       OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
        RETURN QUERY
        SELECT 'invalid_request'::TEXT, 'Invalid token hash format'::TEXT;
        RETURN;
    END IF;

    IF p_telegram_user_id IS NULL OR p_telegram_user_id <= 0 THEN
        RETURN QUERY
        SELECT 'invalid_request'::TEXT, 'Telegram user ID must be positive'::TEXT;
        RETURN;
    END IF;

    IF p_telegram_chat_id IS NULL OR p_telegram_chat_id <= 0 THEN
        RETURN QUERY
        SELECT 'invalid_request'::TEXT, 'Telegram chat ID must be positive'::TEXT;
        RETURN;
    END IF;


    -- ------------------------------------------------------------------------
    -- 2. Lock the token row.
    -- ------------------------------------------------------------------------

    SELECT t.*
    INTO v_token
    FROM public.telegram_link_tokens AS t
    WHERE t.token_hash = p_token_hash
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN QUERY
        SELECT 'invalid_token'::TEXT, 'Unknown token hash'::TEXT;
        RETURN;
    END IF;


    -- ------------------------------------------------------------------------
    -- 3. Revocation takes precedence over consumed status.
    -- ------------------------------------------------------------------------

    IF v_token.revoked_at IS NOT NULL THEN
        RETURN QUERY
        SELECT 'revoked_token'::TEXT, 'Token has been revoked'::TEXT;
        RETURN;
    END IF;


    -- ------------------------------------------------------------------------
    -- 4. Handle repeat redemption of the same consumed token.
    --
    -- The recorded identity is authoritative. Do not infer idempotency from
    -- the current state of telegram_links because the link may later be
    -- unlinked.
    -- ------------------------------------------------------------------------

    IF v_token.consumed_at IS NOT NULL THEN
        IF v_token.redeemed_telegram_user_id = p_telegram_user_id
           AND v_token.redeemed_telegram_chat_id = p_telegram_chat_id THEN
            RETURN QUERY
            SELECT
                'already_redeemed'::TEXT,
                'This Telegram account already redeemed this token'::TEXT;
            RETURN;
        END IF;

        RETURN QUERY
        SELECT
            'token_already_used'::TEXT,
            'Token has already been consumed'::TEXT;
        RETURN;
    END IF;


    -- ------------------------------------------------------------------------
    -- 5. Check expiry.
    -- ------------------------------------------------------------------------

    IF v_token.expires_at <= pg_catalog.now() THEN
        RETURN QUERY
        SELECT 'expired_token'::TEXT, 'Token has expired'::TEXT;
        RETURN;
    END IF;


    -- ------------------------------------------------------------------------
    -- 6. Check whether the merchant already has an active Telegram link.
    -- ------------------------------------------------------------------------

    IF EXISTS (
        SELECT 1
        FROM public.telegram_links AS l
        WHERE l.merchant_wallet_address = v_token.merchant_wallet_address
          AND l.unlinked_at IS NULL
    ) THEN
        RETURN QUERY
        SELECT
            'merchant_already_linked'::TEXT,
            'Merchant already has an active Telegram link'::TEXT;
        RETURN;
    END IF;


    -- ------------------------------------------------------------------------
    -- 7. Check whether this Telegram user is already linked.
    -- ------------------------------------------------------------------------

    IF EXISTS (
        SELECT 1
        FROM public.telegram_links AS l
        WHERE l.telegram_user_id = p_telegram_user_id
          AND l.unlinked_at IS NULL
    ) THEN
        RETURN QUERY
        SELECT
            'telegram_already_linked'::TEXT,
            'Telegram user is already linked to a merchant'::TEXT;
        RETURN;
    END IF;


    -- ------------------------------------------------------------------------
    -- 8. Atomically consume the token and create the link.
    --
    -- The nested block is intentional. If the INSERT raises unique_violation,
    -- PostgreSQL rolls back both the token UPDATE and the link INSERT inside
    -- this subtransaction. The outer function can then return conflict without
    -- leaving the token consumed.
    -- ------------------------------------------------------------------------

    BEGIN
        UPDATE public.telegram_link_tokens AS t
        SET
            consumed_at = pg_catalog.now(),
            redeemed_telegram_user_id = p_telegram_user_id,
            redeemed_telegram_chat_id = p_telegram_chat_id
        WHERE t.id = v_token.id
          AND t.consumed_at IS NULL
          AND t.revoked_at IS NULL;

        GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

        IF v_rows_updated <> 1 THEN
            RAISE EXCEPTION
                'Telegram token was no longer available for redemption';
        END IF;

        INSERT INTO public.telegram_links (
            id,
            merchant_wallet_address,
            telegram_user_id,
            telegram_chat_id,
            telegram_username,
            linked_at,
            created_at
        )
        VALUES (
            gen_random_uuid(),
            v_token.merchant_wallet_address,
            p_telegram_user_id,
            p_telegram_chat_id,
            p_telegram_username,
            pg_catalog.now(),
            pg_catalog.now()
        );

    EXCEPTIONWHEN unique_violation THEN
            RETURN QUERY
                SELECT 'token_already_used'::TEXT, 'A concurrent Telegram linking request caused a conflict - token unchanged'::TEXT;
                RETURN;
    END;


    -- ------------------------------------------------------------------------
    -- 9. Successful redemption.
    -- ------------------------------------------------------------------------

    RETURN QUERY
    SELECT
        'linked'::TEXT,
        'Telegram account linked successfully'::TEXT;

    RETURN;
END;
$function$;


-- ============================================================================
-- 10. FUNCTION EXECUTION PRIVILEGES
-- ============================================================================

REVOKE ALL
ON FUNCTION public.redeem_telegram_token(TEXT, BIGINT, BIGINT, TEXT)
FROM PUBLIC;

REVOKE ALL
ON FUNCTION public.redeem_telegram_token(TEXT, BIGINT, BIGINT, TEXT)
FROM anon;

REVOKE ALL
ON FUNCTION public.redeem_telegram_token(TEXT, BIGINT, BIGINT, TEXT)
FROM authenticated;

GRANT EXECUTE
ON FUNCTION public.redeem_telegram_token(TEXT, BIGINT, BIGINT, TEXT)
TO service_role;


-- ============================================================================
-- 11. FINAL POSTCONDITION CHECKS
--
-- The migration must not silently finish if required production objects
-- are missing.
-- ============================================================================

DO $$
DECLARE
    v_missing TEXT;
BEGIN
    -- Required tables.
    IF to_regclass('public.telegram_link_tokens') IS NULL
       OR to_regclass('public.telegram_links') IS NULL THEN
        RAISE EXCEPTION 'Telegram migration failed: required table is missing.';
    END IF;

    -- Required token indexes.
    SELECT string_agg(required.index_name, ', ')
    INTO v_missing
    FROM (
        VALUES
            ('telegram_link_tokens_pkey'),
            ('telegram_link_tokens_token_hash_key'),
            ('telegram_link_tokens_one_pending_per_merchant'),
            ('telegram_link_tokens_expiry_idx'),
            ('telegram_link_tokens_merchant_idx')
    ) AS required(index_name)
    WHERE NOT EXISTS (
        SELECT 1
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname = required.index_name
          AND c.relkind = 'i'
    );

    IF v_missing IS NOT NULL THEN
        RAISE EXCEPTION
            'Telegram migration failed: missing token indexes: %',
            v_missing;
    END IF;

    -- Required link indexes.
    SELECT string_agg(required.index_name, ', ')
    INTO v_missing
    FROM (
        VALUES
            ('telegram_links_pkey'),
            ('telegram_links_one_active_per_merchant'),
            ('telegram_links_one_active_per_user'),
            ('telegram_links_merchant_lookup_idx'),
            ('telegram_links_telegram_chat_lookup_idx')
    ) AS required(index_name)
    WHERE NOT EXISTS (
        SELECT 1
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname = required.index_name
          AND c.relkind = 'i'
    );

    IF v_missing IS NOT NULL THEN
        RAISE EXCEPTION
            'Telegram migration failed: missing link indexes: %',
            v_missing;
    END IF;

    -- Required token constraints.
    SELECT string_agg(required.constraint_name, ', ')
    INTO v_missing
    FROM (
        VALUES
            ('telegram_link_tokens_positive_expiry'),
            ('telegram_link_tokens_redeemed_identity'),
            ('telegram_link_tokens_redemption_identity_check'),
            ('telegram_link_tokens_token_hash_is_sha256_hex')
    ) AS required(constraint_name)
    WHERE NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        WHERE c.conrelid = 'public.telegram_link_tokens'::regclass
          AND c.conname = required.constraint_name
    );

    IF v_missing IS NOT NULL THEN
        RAISE EXCEPTION
            'Telegram migration failed: missing token constraints: %',
            v_missing;
    END IF;

    -- Required link constraints.
    SELECT string_agg(required.constraint_name, ', ')
    INTO v_missing
    FROM (
        VALUES
            ('telegram_links_positive_chat'),
            ('telegram_links_positive_user')
    ) AS required(constraint_name)
    WHERE NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        WHERE c.conrelid = 'public.telegram_links'::regclass
          AND c.conname = required.constraint_name
    );

    IF v_missing IS NOT NULL THEN
        RAISE EXCEPTION
            'Telegram migration failed: missing link constraints: %',
            v_missing;
    END IF;

    -- RLS must be enabled.
    IF NOT (
        SELECT relrowsecurity
        FROM pg_class
        WHERE oid = 'public.telegram_link_tokens'::regclass
    ) OR NOT (
        SELECT relrowsecurity
        FROM pg_class
        WHERE oid = 'public.telegram_links'::regclass
    ) THEN
        RAISE EXCEPTION
            'Telegram migration failed: RLS is not enabled on both tables.';
    END IF;

    -- Redemption function must exist.
    IF to_regprocedure(
        'public.redeem_telegram_token(text,bigint,bigint,text)'
    ) IS NULL THEN
        RAISE EXCEPTION
            'Telegram migration failed: redemption function is missing.';
    END IF;
END;
$$;

-- ============================================================================
-- END OF MIGRATION
-- ============================================================================
