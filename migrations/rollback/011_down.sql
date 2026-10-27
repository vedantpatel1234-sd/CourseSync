-- Reverts 011: removes the per-organization restriction. Role rules from 006/007 remain.
-- WARNING: with several organizations in the database this re-opens cross-organization
-- access. Only use it to recover from a bad rollout while a single organization exists.

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
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
