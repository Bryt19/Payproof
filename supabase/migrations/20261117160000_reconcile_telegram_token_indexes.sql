
BEGIN;

SET LOCAL lock_timeout = '5s';

-- ============================================================
-- PAYPROOF TELEGRAM DATABASE SCHEMA
-- ============================================================
-- Tables:
--   public.telegram_link_tokens
--   public.telegram_links
--
-- Security:
--   RLS enabled, not forced.
--   No browser-facing policies.
--   anon/authenticated/PUBLIC have no table access.
--   service_role has server-side table access.
--
-- Existing RPC functions are NOT modified.
-- No existing tables, rows, constraints or indexes are dropped.
-- ============================================================


-- ============================================================
-- 1. TELEGRAM LINK TOKENS TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS public.telegram_link_tokens (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    merchant_wallet_address TEXT NOT NULL,
    token_hash TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    redeemed_telegram_user_id BIGINT,
    redeemed_telegram_chat_id BIGINT,
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


-- ============================================================
-- 2. TELEGRAM LINKS TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS public.telegram_links (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    merchant_wallet_address TEXT NOT NULL,
    telegram_user_id BIGINT NOT NULL,
    telegram_chat_id BIGINT NOT NULL,
    telegram_username TEXT,
    linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    unlinked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT telegram_links_pkey
        PRIMARY KEY (id),

    CONSTRAINT telegram_links_positive_chat
        CHECK (telegram_chat_id > 0),

    CONSTRAINT telegram_links_positive_user
        CHECK (telegram_user_id > 0)
);


-- ============================================================
-- 3. ENABLE AND CONFIGURE RLS
-- ============================================================

ALTER TABLE public.telegram_link_tokens
    ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.telegram_links
    ENABLE ROW LEVEL SECURITY;

-- Do not force RLS.
-- The table owner retains normal owner privileges.
-- service_role access is server-side and bypasses RLS.

ALTER TABLE public.telegram_link_tokens
    NO FORCE ROW LEVEL SECURITY;

ALTER TABLE public.telegram_links
    NO FORCE ROW LEVEL SECURITY;


-- ============================================================
-- 4. REMOVE BROWSER-FACING POLICIES
-- ============================================================

-- No browser-facing access policies are required.
-- Remove these known policy names if they exist.

DROP POLICY IF EXISTS telegram_link_tokens_deny_browser_roles
    ON public.telegram_link_tokens;

DROP POLICY IF EXISTS telegram_links_deny_browser_roles
    ON public.telegram_links;


-- ============================================================
-- 5. REVOKE BROWSER TABLE PRIVILEGES
-- ============================================================

REVOKE ALL PRIVILEGES
ON TABLE public.telegram_link_tokens
FROM PUBLIC, anon, authenticated;

REVOKE ALL PRIVILEGES
ON TABLE public.telegram_links
FROM PUBLIC, anon, authenticated;


-- ============================================================
-- 6. REVOKE BROWSER COLUMN PRIVILEGES
-- ============================================================

DO $revoke_column_privileges$
DECLARE
    v_table TEXT;
    v_column TEXT;
BEGIN
    FOREACH v_table IN ARRAY ARRAY[
        'telegram_link_tokens',
        'telegram_links'
    ]
    LOOP
        FOR v_column IN
            SELECT a.attname
            FROM pg_attribute a
            WHERE a.attrelid =
                format('public.%I', v_table)::regclass
              AND a.attnum > 0
              AND NOT a.attisdropped
        LOOP
            EXECUTE format(
                'REVOKE ALL (%I) ON TABLE public.%I FROM PUBLIC',
                v_column,
                v_table
            );

            EXECUTE format(
                'REVOKE ALL (%I) ON TABLE public.%I FROM anon',
                v_column,
                v_table
            );

            EXECUTE format(
                'REVOKE ALL (%I) ON TABLE public.%I FROM authenticated',
                v_column,
                v_table
            );
        END LOOP;
    END LOOP;
END
$revoke_column_privileges$;


-- ============================================================
-- 7. GRANT SERVER-SIDE SERVICE ROLE ACCESS
-- ============================================================

GRANT SELECT, INSERT, UPDATE, DELETE
ON TABLE public.telegram_link_tokens
TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE
ON TABLE public.telegram_links
TO service_role;


-- ============================================================
-- 8. TOKEN HASH UNIQUE CONSTRAINT VERIFICATION
-- ============================================================

DO $verify_token_hash$
DECLARE
    v_att SMALLINT;
    v_constraint_count INTEGER;
BEGIN
    SELECT attnum
    INTO v_att
    FROM pg_attribute
    WHERE attrelid = 'public.telegram_link_tokens'::regclass
      AND attname = 'token_hash'
      AND attnum > 0
      AND NOT attisdropped;

    IF v_att IS NULL THEN
        RAISE EXCEPTION 'Required token_hash column is missing.';
    END IF;

    SELECT COUNT(*)
    INTO v_constraint_count
    FROM pg_constraint
    WHERE conrelid = 'public.telegram_link_tokens'::regclass
      AND conname = 'telegram_link_tokens_token_hash_key'
      AND contype = 'u'
      AND conkey = ARRAY[v_att]
      AND convalidated;

    IF v_constraint_count <> 1 THEN
        RAISE EXCEPTION
            'Expected exact UNIQUE constraint telegram_link_tokens_token_hash_key(token_hash) is missing or incompatible.';
    END IF;
END
$verify_token_hash$;


-- ============================================================
-- 9. VERIFY REQUIRED CHECK CONSTRAINTS
-- ============================================================

DO $verify_checks$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.telegram_link_tokens'::regclass
          AND conname = 'telegram_link_tokens_positive_expiry'
          AND contype = 'c'
          AND convalidated
    ) THEN
        RAISE EXCEPTION
            'Missing or unvalidated constraint: telegram_link_tokens_positive_expiry.';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.telegram_link_tokens'::regclass
          AND conname = 'telegram_link_tokens_redeemed_identity'
          AND contype = 'c'
          AND convalidated
    ) THEN
        RAISE EXCEPTION
            'Missing or unvalidated constraint: telegram_link_tokens_redeemed_identity.';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.telegram_link_tokens'::regclass
          AND conname = 'telegram_link_tokens_redemption_identity_check'
          AND contype = 'c'
          AND convalidated
    ) THEN
        RAISE EXCEPTION
            'Missing or unvalidated constraint: telegram_link_tokens_redemption_identity_check.';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.telegram_link_tokens'::regclass
          AND conname = 'telegram_link_tokens_token_hash_is_sha256_hex'
          AND contype = 'c'
          AND convalidated
    ) THEN
        RAISE EXCEPTION
            'Missing or unvalidated constraint: telegram_link_tokens_token_hash_is_sha256_hex.';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.telegram_links'::regclass
          AND conname = 'telegram_links_positive_chat'
          AND contype = 'c'
          AND convalidated
    ) THEN
        RAISE EXCEPTION
            'Missing or unvalidated constraint: telegram_links_positive_chat.';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.telegram_links'::regclass
          AND conname = 'telegram_links_positive_user'
          AND contype = 'c'
          AND convalidated
    ) THEN
        RAISE EXCEPTION
            'Missing or unvalidated constraint: telegram_links_positive_user.';
    END IF;
END
$verify_checks$;


-- ============================================================
-- 10. CREATE REQUIRED PENDING TOKEN INDEX
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS
    telegram_link_tokens_one_pending_per_merchant
ON public.telegram_link_tokens (merchant_wallet_address)
WHERE consumed_at IS NULL
  AND revoked_at IS NULL;


-- ============================================================
-- 11. CREATE ACTIVE LINK INDEXES
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS
    telegram_links_one_active_per_merchant
ON public.telegram_links (merchant_wallet_address)
WHERE unlinked_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS
    telegram_links_one_active_per_user
ON public.telegram_links (telegram_user_id)
WHERE unlinked_at IS NULL;


-- ============================================================
-- 12. CREATE LOOKUP INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS
    telegram_link_tokens_expiry_idx
ON public.telegram_link_tokens (expires_at);

CREATE INDEX IF NOT EXISTS
    telegram_link_tokens_merchant_idx
ON public.telegram_link_tokens (merchant_wallet_address);

CREATE INDEX IF NOT EXISTS
    telegram_links_merchant_lookup_idx
ON public.telegram_links (merchant_wallet_address);

CREATE INDEX IF NOT EXISTS
    telegram_links_telegram_chat_lookup_idx
ON public.telegram_links (telegram_chat_id);


-- ============================================================
-- 13. VERIFY ALL EIGHT INDEX DEFINITIONS
-- ============================================================

DO $verify_indexes$
DECLARE
    spec RECORD;
    v_att SMALLINT;
    v_index_oid OID;
    v_expected_predicate TEXT;
    v_actual_predicate TEXT;
BEGIN
    FOR spec IN
        SELECT *
        FROM (VALUES
            (
                'telegram_link_tokens_token_hash_key',
                'telegram_link_tokens',
                'token_hash',
                TRUE,
                NULL::TEXT
            ),
            (
                'telegram_link_tokens_one_pending_per_merchant',
                'telegram_link_tokens',
                'merchant_wallet_address',
                TRUE,
                'consumed_at IS NULL AND revoked_at IS NULL'
            ),
            (
                'telegram_links_one_active_per_merchant',
                'telegram_links',
                'merchant_wallet_address',
                TRUE,
                'unlinked_at IS NULL'
            ),
            (
                'telegram_links_one_active_per_user',
                'telegram_links',
                'telegram_user_id',
                TRUE,
                'unlinked_at IS NULL'
            ),
            (
                'telegram_link_tokens_expiry_idx',
                'telegram_link_tokens',
                'expires_at',
                FALSE,
                NULL::TEXT
            ),
            (
                'telegram_link_tokens_merchant_idx',
                'telegram_link_tokens',
                'merchant_wallet_address',
                FALSE,
                NULL::TEXT
            ),
            (
                'telegram_links_merchant_lookup_idx',
                'telegram_links',
                'merchant_wallet_address',
                FALSE,
                NULL::TEXT
            ),
            (
                'telegram_links_telegram_chat_lookup_idx',
                'telegram_links',
                'telegram_chat_id',
                FALSE,
                NULL::TEXT
            )
        ) AS x(index_name, table_name, column_name, is_unique, predicate)
    LOOP
        SELECT a.attnum
        INTO v_att
        FROM pg_attribute a
        WHERE a.attrelid =
            format('public.%I', spec.table_name)::regclass
          AND a.attname = spec.column_name
          AND a.attnum > 0
          AND NOT a.attisdropped;

        IF v_att IS NULL THEN
            RAISE EXCEPTION
                'Required column %.% is missing.',
                spec.table_name,
                spec.column_name;
        END IF;

        SELECT c.oid
        INTO v_index_oid
        FROM pg_class c
        JOIN pg_namespace n
          ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname = spec.index_name
          AND c.relkind IN ('i', 'I');

        IF v_index_oid IS NULL THEN
            RAISE EXCEPTION
                'Required index % is missing.',
                spec.index_name;
        END IF;

        IF spec.predicate IS NOT NULL THEN
            v_expected_predicate :=
                lower(
                    regexp_replace(
                        spec.predicate,
                        '[[:space:]()]',
                        '',
                        'g'
                    )
                );

            SELECT lower(
                regexp_replace(
                    pg_get_expr(i.indpred, i.indrelid),
                    '[[:space:]()]',
                    '',
                    'g'
                )
            )
            INTO v_actual_predicate
            FROM pg_index i
            WHERE i.indexrelid = v_index_oid;
        ELSE
            v_expected_predicate := NULL;
            v_actual_predicate := NULL;
        END IF;

        IF NOT EXISTS (
            SELECT 1
            FROM pg_index i
            JOIN pg_class idx
              ON idx.oid = i.indexrelid
            JOIN pg_am am
              ON am.oid = idx.relam
            WHERE i.indexrelid = v_index_oid
              AND i.indrelid =
                  format('public.%I', spec.table_name)::regclass
              AND i.indisunique = spec.is_unique
              AND i.indnkeyatts = 1
              AND i.indnatts = 1
              AND i.indkey::text = v_att::TEXT
              AND i.indexprs IS NULL
              AND am.amname = 'btree'
              AND i.indisvalid
              AND i.indisready
              AND i.indislive
              AND (
                  (
                      spec.predicate IS NULL
                      AND i.indpred IS NULL
                  )
                  OR
                  (
                      spec.predicate IS NOT NULL
                      AND i.indpred IS NOT NULL
                      AND v_actual_predicate = v_expected_predicate
                  )
              )
        ) THEN
            RAISE EXCEPTION
                'Index % has an incompatible definition.',
                spec.index_name;
        END IF;
    END LOOP;
END
$verify_indexes$;


-- ============================================================
-- 14. VERIFY RLS AND PRIVILEGES
-- ============================================================

DO $verify_security$
DECLARE
    v_tokens_rls BOOLEAN;
    v_links_rls BOOLEAN;
    v_tokens_force BOOLEAN;
    v_links_force BOOLEAN;
BEGIN
    SELECT relrowsecurity, relforcerowsecurity
    INTO v_tokens_rls, v_tokens_force
    FROM pg_class
    WHERE oid = 'public.telegram_link_tokens'::regclass;

    SELECT relrowsecurity, relforcerowsecurity
    INTO v_links_rls, v_links_force
    FROM pg_class
    WHERE oid = 'public.telegram_links'::regclass;

    IF v_tokens_rls IS DISTINCT FROM TRUE
       OR v_links_rls IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION
            'RLS must be enabled on both Telegram tables.';
    END IF;

    IF v_tokens_force IS DISTINCT FROM FALSE
       OR v_links_force IS DISTINCT FROM FALSE THEN
        RAISE EXCEPTION
            'RLS must not be forced on either Telegram table.';
    END IF;

    IF has_table_privilege(
        'anon',
        'public.telegram_link_tokens',
        'SELECT,INSERT,UPDATE,DELETE'
    ) OR has_table_privilege(
        'authenticated',
        'public.telegram_link_tokens',
        'SELECT,INSERT,UPDATE,DELETE'
    ) THEN
        RAISE EXCEPTION
            'Browser role privileges remain on telegram_link_tokens.';
    END IF;

    IF has_table_privilege(
        'anon',
        'public.telegram_links',
        'SELECT,INSERT,UPDATE,DELETE'
    ) OR has_table_privilege(
        'authenticated',
        'public.telegram_links',
        'SELECT,INSERT,UPDATE,DELETE'
    ) THEN
        RAISE EXCEPTION
            'Browser role privileges remain on telegram_links.';
    END IF;

    IF NOT has_table_privilege(
        'service_role',
        'public.telegram_link_tokens',
        'SELECT,INSERT,UPDATE,DELETE'
    ) THEN
        RAISE EXCEPTION
            'service_role is missing required privileges on telegram_link_tokens.';
    END IF;

    IF NOT has_table_privilege(
        'service_role',
        'public.telegram_links',
        'SELECT,INSERT,UPDATE,DELETE'
    ) THEN
        RAISE EXCEPTION
            'service_role is missing required privileges on telegram_links.';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename IN (
              'telegram_link_tokens',
              'telegram_links'
          )
    ) THEN
        RAISE EXCEPTION
            'Unexpected policies exist on the Telegram tables. Review them before proceeding.';
    END IF;
END
$verify_security$;


COMMIT;
