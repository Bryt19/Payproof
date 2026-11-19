
-- ============================================================
-- PayProof Stage 4.2B
-- Database Security Hardening
-- Date: 2026-11-17
--
-- Goals:
-- 1. Remove excessive default privileges for browser roles.
-- 2. Secure the notifications table.
-- 3. Preserve service_role access.
-- 4. Preserve all existing records.
-- 5. Keep sensitive database access server-side.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. Correct default TABLE privileges
-- ------------------------------------------------------------

ALTER DEFAULT PRIVILEGES
FOR ROLE postgres
IN SCHEMA public
REVOKE ALL ON TABLES FROM anon, authenticated, PUBLIC;

ALTER DEFAULT PRIVILEGES
FOR ROLE supabase_admin
IN SCHEMA public
REVOKE ALL ON TABLES FROM anon, authenticated, PUBLIC;


-- ------------------------------------------------------------
-- 2. Correct default SEQUENCE privileges
-- ------------------------------------------------------------

ALTER DEFAULT PRIVILEGES
FOR ROLE postgres
IN SCHEMA public
REVOKE ALL ON SEQUENCES FROM anon, authenticated, PUBLIC;

ALTER DEFAULT PRIVILEGES
FOR ROLE supabase_admin
IN SCHEMA public
REVOKE ALL ON SEQUENCES FROM anon, authenticated, PUBLIC;


-- ------------------------------------------------------------
-- 3. Correct default FUNCTION execution privileges
-- ------------------------------------------------------------

ALTER DEFAULT PRIVILEGES
FOR ROLE postgres
IN SCHEMA public
REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated, PUBLIC;

ALTER DEFAULT PRIVILEGES
FOR ROLE supabase_admin
IN SCHEMA public
REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated, PUBLIC;


-- ------------------------------------------------------------
-- 4. Secure existing notifications table
-- ------------------------------------------------------------

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Remove table-level client privileges.
REVOKE ALL PRIVILEGES
ON TABLE public.notifications
FROM anon, authenticated, PUBLIC;

-- Remove any separately assigned column-level privileges.
DO $$
DECLARE
    column_record RECORD;
BEGIN
    FOR column_record IN
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'notifications'
    LOOP
        EXECUTE format(
            'REVOKE ALL PRIVILEGES (%I) ON TABLE public.notifications FROM anon, authenticated, PUBLIC',
            column_record.column_name
        );
    END LOOP;
END;
$$;

-- Preserve server-side access.
GRANT ALL PRIVILEGES
ON TABLE public.notifications
TO service_role;


-- ------------------------------------------------------------
-- 5. Add explicit restrictive RLS protection
-- ------------------------------------------------------------

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'notifications'
          AND policyname = 'notifications_deny_browser_roles'
    ) THEN
        CREATE POLICY notifications_deny_browser_roles
        ON public.notifications
        AS RESTRICTIVE
        FOR ALL
        TO anon, authenticated
        USING (false)
        WITH CHECK (false);
    END IF;
END;
$$;

COMMIT;

-- ============================================================
-- END STAGE 4.2B DATABASE SECURITY MIGRATION
-- ============================================================
