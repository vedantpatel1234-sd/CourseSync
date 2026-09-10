-- Row-Level Security for every table, replacing the project-wide "RLS disabled"
-- state. Policies are derived from how the actual app code queries each table
-- (grepped across every page), not guessed. All policies are scoped to the
-- `authenticated` role only — an unauthenticated request (anon key with no
-- logged-in session) gets nothing from any table.
--
-- app_role() is a SECURITY DEFINER helper so policies can check the caller's
-- role without querying `profiles` directly from within a `profiles` policy
-- (which would cause "infinite recursion detected" in Postgres).

CREATE OR REPLACE FUNCTION public.app_role()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT role FROM profiles WHERE id = auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- profiles / instructor_profiles
-- Read by every role everywhere (names, emails, hours shown across all
-- pages). Writes only ever happen via the manage-instructor Edge Function,
-- which uses the service-role key and bypasses RLS entirely — so no client
-- write policy is needed or added.
-- ---------------------------------------------------------------------------
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles_select_authenticated" ON profiles
  FOR SELECT TO authenticated USING (true);

ALTER TABLE instructor_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "instructor_profiles_select_authenticated" ON instructor_profiles
  FOR SELECT TO authenticated USING (true);

-- ---------------------------------------------------------------------------
-- courses / terms
-- Read by everyone. Only admin adds/deletes courses (Courses.tsx, Import.tsx);
-- nothing in the app ever writes to terms, so terms gets no write policy.
-- ---------------------------------------------------------------------------
ALTER TABLE courses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "courses_select_authenticated" ON courses
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "courses_admin_insert" ON courses
  FOR INSERT TO authenticated WITH CHECK (app_role() = 'admin');
CREATE POLICY "courses_admin_delete" ON courses
  FOR DELETE TO authenticated USING (app_role() = 'admin');

ALTER TABLE terms ENABLE ROW LEVEL SECURITY;
CREATE POLICY "terms_select_authenticated" ON terms
  FOR SELECT TO authenticated USING (true);

-- ---------------------------------------------------------------------------
-- sections
-- Read by everyone. Only admin creates/edits/deletes (Sections.tsx). The
-- status-recalculation trigger fires from admin-initiated assignment changes,
-- so it runs in an admin session and is covered by the admin update policy.
-- ---------------------------------------------------------------------------
ALTER TABLE sections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sections_select_authenticated" ON sections
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "sections_admin_insert" ON sections
  FOR INSERT TO authenticated WITH CHECK (app_role() = 'admin');
CREATE POLICY "sections_admin_update" ON sections
  FOR UPDATE TO authenticated USING (app_role() = 'admin') WITH CHECK (app_role() = 'admin');
CREATE POLICY "sections_admin_delete" ON sections
  FOR DELETE TO authenticated USING (app_role() = 'admin');

-- ---------------------------------------------------------------------------
-- assignments
-- The one table with real per-row visibility rules:
--  - admin: full access to everything, live or draft (Assignments, Matching,
--    Drafts, DraftDetail, the AI Copilot and Auto-Scheduler are all admin-only).
--  - coordinator: read-only, live rows only (every coordinator query filters
--    draft_id IS NULL — drafts are explicitly "admin only" per the app's own
--    Sandbox Mode banner copy).
--  - instructor: read-only, their own live rows only (Dashboard, Availability).
-- ---------------------------------------------------------------------------
ALTER TABLE assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "assignments_admin_all" ON assignments
  FOR ALL TO authenticated USING (app_role() = 'admin') WITH CHECK (app_role() = 'admin');
CREATE POLICY "assignments_select_live_coordinator" ON assignments
  FOR SELECT TO authenticated USING (app_role() = 'coordinator' AND draft_id IS NULL);
CREATE POLICY "assignments_select_own_live_instructor" ON assignments
  FOR SELECT TO authenticated USING (app_role() = 'instructor' AND draft_id IS NULL AND instructor_id = auth.uid());

-- ---------------------------------------------------------------------------
-- instructor_availability / preferences
-- Instructors fully manage their own rows (Availability.tsx, Preferences.tsx).
-- Admin reads everyone's for conflict-checking (Matching, Assignments,
-- DraftDetail, Auto-Scheduler all read the whole table).
-- ---------------------------------------------------------------------------
ALTER TABLE instructor_availability ENABLE ROW LEVEL SECURITY;
CREATE POLICY "availability_select_admin_all" ON instructor_availability
  FOR SELECT TO authenticated USING (app_role() = 'admin');
CREATE POLICY "availability_own_all_instructor" ON instructor_availability
  FOR ALL TO authenticated USING (instructor_id = auth.uid()) WITH CHECK (instructor_id = auth.uid());

ALTER TABLE preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "preferences_select_admin_all" ON preferences
  FOR SELECT TO authenticated USING (app_role() = 'admin');
CREATE POLICY "preferences_own_all_instructor" ON preferences
  FOR ALL TO authenticated USING (instructor_id = auth.uid()) WITH CHECK (instructor_id = auth.uid());

-- ---------------------------------------------------------------------------
-- qualifications
-- Instructors claim/unclaim their own (insert/delete); only admin can flip
-- the `verified` flag (update) — matches Instructors.tsx's verify toggle
-- being the only place `verified` is ever written.
-- ---------------------------------------------------------------------------
ALTER TABLE qualifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "qualifications_select_admin_all" ON qualifications
  FOR SELECT TO authenticated USING (app_role() = 'admin');
CREATE POLICY "qualifications_select_own_instructor" ON qualifications
  FOR SELECT TO authenticated USING (instructor_id = auth.uid());
CREATE POLICY "qualifications_insert_own_instructor" ON qualifications
  FOR INSERT TO authenticated WITH CHECK (instructor_id = auth.uid());
CREATE POLICY "qualifications_delete_own_instructor" ON qualifications
  FOR DELETE TO authenticated USING (instructor_id = auth.uid());
CREATE POLICY "qualifications_update_admin" ON qualifications
  FOR UPDATE TO authenticated USING (app_role() = 'admin') WITH CHECK (app_role() = 'admin');

-- ---------------------------------------------------------------------------
-- notifications / notification_preferences
-- Instructors see/manage only their own feed and prefs. Admin never reads
-- notifications (no admin-facing feed exists) but every notifyInstructor()
-- call runs from an admin session inserting a row for a different user, so
-- admin needs an explicit insert policy.
-- ---------------------------------------------------------------------------
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "notifications_select_own" ON notifications
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "notifications_update_own" ON notifications
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "notifications_insert_admin" ON notifications
  FOR INSERT TO authenticated WITH CHECK (app_role() = 'admin');

ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "notification_preferences_own_all" ON notification_preferences
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- drafts / digests / audit_logs
-- All three are exclusively read and written from admin-only pages
-- (Drafts/DraftDetail, Digest, Audit) — confirmed no instructor or
-- coordinator page ever touches them.
-- ---------------------------------------------------------------------------
ALTER TABLE drafts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "drafts_admin_all" ON drafts
  FOR ALL TO authenticated USING (app_role() = 'admin') WITH CHECK (app_role() = 'admin');

ALTER TABLE digests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "digests_admin_all" ON digests
  FOR ALL TO authenticated USING (app_role() = 'admin') WITH CHECK (app_role() = 'admin');

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit_logs_admin_all" ON audit_logs
  FOR ALL TO authenticated USING (app_role() = 'admin') WITH CHECK (app_role() = 'admin');

NOTIFY pgrst, 'reload schema';
