
-- ============================================================
-- PayProof: Remove Unrestricted Public SELECT Access
-- Migration: 20261120085832_remove_unrestricted_select_policy
-- ============================================================
--
-- Purpose:
-- Remove the unrestricted SELECT policy that allowed
-- anonymous and authenticated clients to read every row
-- in public.payment_requests.
--
-- Security model:
-- - Public checkout continues through server-side API routes.
-- - Server-side database operations use the service-role key.
-- - Service-role access bypasses RLS.
-- - Merchant-facing access remains server-side and scoped
--   to the authenticated merchant.
--
-- Important:
-- - Does not delete or modify payment records.
-- - Does not disable RLS.
-- - Does not change table grants.
-- - Does not modify the existing "no public writes" policy.
-- - Does not create a replacement public SELECT policy.
-- ============================================================

DROP POLICY IF EXISTS
  "checkout can read any request by reference"
ON public.payment_requests;

-- ============================================================
-- End of migration
-- ============================================================
