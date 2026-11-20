
-- PayProof: RPC to select eligible notification deliveries
-- Used by the durable retry endpoint.

CREATE OR REPLACE FUNCTION public.get_eligible_deliveries()
RETURNS SETOF public.notification_deliveries
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT nd.*
  FROM public.notification_deliveries nd
  WHERE nd.attempt < nd.max_attempts
    AND nd.status IN ('failed', 'pending')
  ORDER BY nd.created_at ASC;
$$;

-- Restrict function execution.
REVOKE ALL ON FUNCTION public.get_eligible_deliveries()
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_eligible_deliveries()
TO service_role;
