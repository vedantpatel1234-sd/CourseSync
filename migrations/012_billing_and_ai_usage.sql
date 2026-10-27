-- Phase 2a: plans, limits and AI usage metering. See docs/phase-2-plan.md. Requires 010/011.
--
--   organization_billing  one row per organization: status, trial, seat and AI limits, contract
--                         record, Stripe ids. Kept apart from `organizations` so ordinary members
--                         never see contract or billing details. Admins read their own row; only
--                         the service role (Edge Functions, vendor scripts) writes.
--   ai_usage              one row per AI call, written by the ai-proxy Edge Function.
--
-- RUN THIS BEFORE deploying the new ai-proxy / manage-instructor: they read these tables and
-- refuse to act (fail closed) if they are missing.

BEGIN;

CREATE TABLE organization_billing (
  organization_id UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  plan TEXT NOT NULL DEFAULT 'trial',
  subscription_status TEXT NOT NULL DEFAULT 'trial'
    CHECK (subscription_status IN ('trial', 'active', 'past_due', 'suspended', 'canceled')),
  trial_ends_at TIMESTAMPTZ,
  -- NULL means unlimited. Defaults here are for new (trial) organizations only.
  max_instructors INTEGER DEFAULT 25 CHECK (max_instructors IS NULL OR max_instructors >= 0),
  ai_enabled BOOLEAN NOT NULL DEFAULT true,
  ai_monthly_token_limit BIGINT DEFAULT 1000000 CHECK (ai_monthly_token_limit IS NULL OR ai_monthly_token_limit >= 0),
  msa_version TEXT,
  msa_signed_at TIMESTAMPTZ,
  msa_signed_by TEXT,
  stripe_customer_id TEXT UNIQUE,
  stripe_subscription_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ai_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ai_usage_organization_created_idx ON ai_usage (organization_id, created_at DESC);

-- Organizations that already exist (the founding school) are ours: active, no limits.
INSERT INTO organization_billing (organization_id, plan, subscription_status, max_instructors, ai_monthly_token_limit)
SELECT id, 'internal', 'active', NULL, NULL FROM organizations;

-- Every organization created from now on starts on a 30-day trial with the default limits above,
-- whoever creates it. Edit the row afterwards (vendor script / SQL) to change plan or limits.
CREATE OR REPLACE FUNCTION public.create_default_billing()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO organization_billing (organization_id, trial_ends_at)
  VALUES (NEW.id, now() + interval '30 days');
  RETURN NEW;
END;
$$;

CREATE TRIGGER organizations_create_billing
  AFTER INSERT ON organizations
  FOR EACH ROW EXECUTE FUNCTION create_default_billing();

CREATE OR REPLACE FUNCTION public.touch_billing_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER organization_billing_touch
  BEFORE UPDATE ON organization_billing
  FOR EACH ROW EXECUTE FUNCTION touch_billing_updated_at();

-- Tokens (input + output) an organization has used since the start of the current UTC month.
-- SECURITY INVOKER: the app calls it as an admin (row-level security limits it to their own
-- organization); Edge Functions call it with the service role and name the organization.
CREATE OR REPLACE FUNCTION public.ai_tokens_used_this_month(p_org UUID)
RETURNS BIGINT
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(SUM(input_tokens + output_tokens), 0)::bigint
  FROM ai_usage
  WHERE organization_id = p_org
    AND created_at >= date_trunc('month', now() AT TIME ZONE 'utc') AT TIME ZONE 'utc';
$$;

-- Row-level security, in the same shape as the other tenant tables (011).
ALTER TABLE organization_billing ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "organization_billing_select_admin" ON organization_billing
  FOR SELECT TO authenticated USING (app_role() = 'admin');
CREATE POLICY "ai_usage_select_admin" ON ai_usage
  FOR SELECT TO authenticated USING (app_role() = 'admin');

CREATE POLICY tenant_isolation ON organization_billing AS RESTRICTIVE FOR ALL TO authenticated
  USING (organization_id = app_org_id())
  WITH CHECK (organization_id = app_org_id());
CREATE POLICY tenant_isolation ON ai_usage AS RESTRICTIVE FOR ALL TO authenticated
  USING (organization_id = app_org_id())
  WITH CHECK (organization_id = app_org_id());

NOTIFY pgrst, 'reload schema';

COMMIT;
