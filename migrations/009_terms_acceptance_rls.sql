-- terms_acceptance was missed by migration 006: row-level security was never enabled,
-- so anyone holding the public anon key could read, forge or delete acceptance records.
--
-- The app only ever (a) inserts the signed-in user's own row (TermsModal.tsx) and
-- (b) reads the signed-in user's own row (authStore.ts), so that is all we allow.
-- Safe to run on its own, ahead of the multi-tenancy migrations.

ALTER TABLE terms_acceptance ENABLE ROW LEVEL SECURITY;

CREATE POLICY "terms_acceptance_select_own" ON terms_acceptance
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "terms_acceptance_insert_own" ON terms_acceptance
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

NOTIFY pgrst, 'reload schema';
