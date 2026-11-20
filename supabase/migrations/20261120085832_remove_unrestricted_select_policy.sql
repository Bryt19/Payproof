-- PayProof Task: Remove unrestricted anonymous SELECT policy on payment_requests.
-- This migration removes the policy "checkout can read any request by reference"
-- which granted universal SELECT access to any anon client via using (true).
-- RLS remains enabled. The service-role key continues to bypass RLS entirely,
-- so all server-side operations are unaffected.
-- No new public SELECT policy is introduced.
-- No merchant JWT claims or assumptions are added.
-- No service-role permissions are changed.

-- Remove the unrestricted SELECT policy that grants universal access
drop policy if exists "checkout can read any request by reference" on payment_requests;

-- Preserve the no-public-writes policy (do not modify)
-- preserve policy "no public writes" on payment_requests for all using (false);

-- RLS remains enabled on payment_requests (no alter table needed)
-- No additional grants or revocations.

-- Verification notes:
-- - Service-role key operations continue uninterrupted (bypasses RLS)
-- - No anon- or authenticated-key SELECT paths are opened
-- - Merchant dashboard and payment-history operations continue to use service-role