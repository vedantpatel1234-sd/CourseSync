-- The RLS migration (006) only gave `terms` a SELECT policy, since nothing in
-- the app wrote to it at the time. The new Term Management page needs admin
-- write access.

CREATE POLICY "terms_admin_insert" ON terms
  FOR INSERT TO authenticated WITH CHECK (app_role() = 'admin');
CREATE POLICY "terms_admin_update" ON terms
  FOR UPDATE TO authenticated USING (app_role() = 'admin') WITH CHECK (app_role() = 'admin');
CREATE POLICY "terms_admin_delete" ON terms
  FOR DELETE TO authenticated USING (app_role() = 'admin');

NOTIFY pgrst, 'reload schema';
