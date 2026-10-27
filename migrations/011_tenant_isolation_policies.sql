-- Multi-tenancy, part 2 of 2: isolation. Requires 010. See docs/multi-tenancy-plan.md.
--
-- One RESTRICTIVE policy per tenant table. Restrictive policies are ANDed with every
-- permissive policy, so all the role rules from 006/007 stay exactly as they are and are now
-- additionally limited to the caller's own organization. A permissive policy added later
-- can't widen access across organizations.
--
-- A signed-in user with no profile (app_org_id() is NULL) matches nothing, which also
-- closes the old hole where `USING (true)` let any authenticated account read every
-- profile, course, term and section.
--
-- Rollback: migrations/rollback/011_down.sql

BEGIN;

DO $$
DECLARE
  t text;
  tenant_tables text[] := ARRAY[
    'profiles', 'instructor_profiles', 'courses', 'terms', 'sections', 'drafts',
    'assignments', 'instructor_availability', 'preferences', 'qualifications',
    'notifications', 'notification_preferences', 'digests', 'audit_logs', 'terms_acceptance'
  ];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I AS RESTRICTIVE FOR ALL TO authenticated
         USING (organization_id = app_org_id())
         WITH CHECK (organization_id = app_org_id())', t);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
