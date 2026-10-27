-- Multi-tenancy, part 1 of 2: structure and data. See docs/multi-tenancy-plan.md.
--
--   * organizations table and the app_org_id() helper
--   * organization_id on every tenant table; existing rows are moved into a single
--     "Founding Organization" (rename it afterwards, see the end of this file)
--   * column default app_org_id(), so client inserts are stamped with the caller's org
--     without any application change
--   * uniqueness that used to be global becomes per organization
--
-- This migration does NOT restrict access by organization; that is 011. Running 010 alone
-- changes nothing about who can see what.
--
-- DEPLOY ORDER: deploy the updated manage-instructor Edge Function right after this
-- runs. It must pass organization_id explicitly (service role has no auth.uid()), and the
-- previous version of the function would fail on the new NOT NULL columns.

BEGIN;

CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Fails with a clear message instead of a constraint error halfway through the backfill.
DO $$
BEGIN
  IF (SELECT count(*) FROM terms WHERE is_active) > 1 THEN
    RAISE EXCEPTION 'More than one term is marked active. Leave exactly one active, then re-run this migration.';
  END IF;
END $$;

DO $$
DECLARE
  t text;
  founding uuid;
  has_rows boolean;
  tenant_tables text[] := ARRAY[
    'profiles', 'instructor_profiles', 'courses', 'terms', 'sections', 'drafts',
    'assignments', 'instructor_availability', 'preferences', 'qualifications',
    'notifications', 'notification_preferences', 'digests', 'audit_logs', 'terms_acceptance'
  ];
BEGIN
  -- Only create the founding organization if there is data to move into it, so a
  -- brand-new project doesn't get a stray empty organization.
  has_rows := false;
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I)', t) INTO has_rows;
    EXIT WHEN has_rows;
  END LOOP;

  IF has_rows THEN
    INSERT INTO organizations (name, slug) VALUES ('Founding Organization', 'founding')
    RETURNING id INTO founding;
  END IF;

  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN organization_id UUID REFERENCES organizations(id)', t);
    IF founding IS NOT NULL THEN
      EXECUTE format('UPDATE %I SET organization_id = $1', t) USING founding;
    END IF;
    EXECUTE format('ALTER TABLE %I ALTER COLUMN organization_id SET NOT NULL', t);
    EXECUTE format('CREATE INDEX %I ON %I (organization_id)', t || '_organization_id_idx', t);
  END LOOP;
END $$;

-- Same pattern as app_role(): SECURITY DEFINER so policies can resolve the caller's
-- organization without recursing into profiles' own policies. Created after profiles has
-- its organization_id column, because Postgres checks SQL function bodies at creation.
CREATE OR REPLACE FUNCTION public.app_org_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT organization_id FROM profiles WHERE id = auth.uid();
$$;

-- Client inserts are stamped with the caller's organization by default. profiles and
-- instructor_profiles are written only by the service role (Edge Functions / provisioning
-- script), which must name the organization explicitly: no default, so forgetting is an error.
DO $$
DECLARE
  t text;
  defaulted_tables text[] := ARRAY[
    'courses', 'terms', 'sections', 'drafts', 'assignments', 'instructor_availability',
    'preferences', 'qualifications', 'notifications', 'notification_preferences',
    'digests', 'audit_logs', 'terms_acceptance'
  ];
BEGIN
  FOREACH t IN ARRAY defaulted_tables LOOP
    EXECUTE format('ALTER TABLE %I ALTER COLUMN organization_id SET DEFAULT app_org_id()', t);
  END LOOP;
END $$;

-- Uniqueness that was global is now per organization.
ALTER TABLE courses DROP CONSTRAINT courses_code_key;
CREATE UNIQUE INDEX courses_organization_code_key ON courses (organization_id, code);

-- "Exactly one active term" was only enforced by Terms.tsx (two separate statements).
-- Now the database enforces it, per organization.
CREATE UNIQUE INDEX one_active_term_per_organization ON terms (organization_id) WHERE is_active;

-- Members can see their own organization (name shown in the app). Writes: service role only.
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "organizations_select_own" ON organizations
  FOR SELECT TO authenticated USING (id = app_org_id());

NOTIFY pgrst, 'reload schema';

COMMIT;

-- Afterwards, name the founding organization properly (if one was created):
--   UPDATE organizations SET name = 'Your College Name', slug = 'your-college' WHERE slug = 'founding';
