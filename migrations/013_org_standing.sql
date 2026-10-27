-- Lets every signed-in user, whatever their role, learn whether their organization is in good
-- standing (so the app can show a "paused" screen or, to admins, a trial / overdue banner).
--
-- organization_billing itself is admin-only: it holds contract and Stripe details. This exposes
-- just three non-sensitive fields about the caller's own organization. Not executable by anon.

CREATE OR REPLACE FUNCTION public.org_standing()
RETURNS TABLE (subscription_status TEXT, trial_ends_at TIMESTAMPTZ, ai_enabled BOOLEAN)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT b.subscription_status, b.trial_ends_at, b.ai_enabled
  FROM organization_billing b
  WHERE b.organization_id = app_org_id();
$$;

REVOKE EXECUTE ON FUNCTION public.org_standing() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.org_standing() TO authenticated;

NOTIFY pgrst, 'reload schema';
