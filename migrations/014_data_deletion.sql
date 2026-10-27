-- Data deletion, in two parts. See docs/phase-2-plan.md (section 3.2) and the Data Processing
-- Addendum, which promises both.
--
--   delete_organization_data(org)  removes everything an organization owns, in the one order the
--                                  foreign keys allow, atomically (all or nothing).
--   erase_person_data(user)        removes one person and what is keyed to them, and scrubs their
--                                  name and email from the activity log and weekly digests.
--
-- Both are for the service role only (scripts/delete-org.mjs and the manage-instructor Edge
-- Function). They are SECURITY INVOKER on purpose: they get no privileges of their own, and the
-- EXECUTE grants below are the access control. Neither touches auth.users; the caller removes the
-- login accounts afterwards (the database cannot do it inside the same transaction).

-- ---------------------------------------------------------------------------------------------
-- Whole organization
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_organization_data(p_org UUID)
RETURNS UUID[]
LANGUAGE plpgsql
AS $$
DECLARE
  v_users UUID[];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM organizations WHERE id = p_org) THEN
    RAISE EXCEPTION 'Organization % does not exist', p_org;
  END IF;

  -- Login accounts to remove afterwards.
  SELECT COALESCE(array_agg(id), ARRAY[]::uuid[]) INTO v_users
  FROM profiles WHERE organization_id = p_org;

  -- Children before parents. assignments (assigned_by) and digests (generated_by) reference
  -- profiles with no cascade, so they must go before profiles.
  DELETE FROM assignments WHERE organization_id = p_org;
  DELETE FROM digests WHERE organization_id = p_org;
  DELETE FROM audit_logs WHERE organization_id = p_org;
  DELETE FROM drafts WHERE organization_id = p_org;
  DELETE FROM notifications WHERE organization_id = p_org;
  DELETE FROM notification_preferences WHERE organization_id = p_org;
  DELETE FROM terms_acceptance WHERE organization_id = p_org;
  DELETE FROM instructor_availability WHERE organization_id = p_org;
  DELETE FROM preferences WHERE organization_id = p_org;
  DELETE FROM qualifications WHERE organization_id = p_org;
  DELETE FROM instructor_profiles WHERE organization_id = p_org;
  DELETE FROM sections WHERE organization_id = p_org;
  DELETE FROM courses WHERE organization_id = p_org;
  DELETE FROM terms WHERE organization_id = p_org;
  DELETE FROM profiles WHERE organization_id = p_org;

  -- organization_billing and ai_usage go with the organization (ON DELETE CASCADE).
  DELETE FROM organizations WHERE id = p_org;

  RETURN v_users;
END;
$$;

-- ---------------------------------------------------------------------------------------------
-- One person
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.erase_person_data(p_user UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_org UUID;
  v_role TEXT;
  v_name TEXT;
  v_email TEXT;
  v_redacted CONSTANT TEXT := '[deleted user]';
BEGIN
  SELECT organization_id, role, full_name, email INTO v_org, v_role, v_name, v_email
  FROM profiles WHERE id = p_user;

  IF NOT FOUND THEN
    RETURN; -- already gone: erasing twice is harmless
  END IF;

  IF v_role = 'admin' AND (SELECT count(*) FROM profiles WHERE organization_id = v_org AND role = 'admin') <= 1 THEN
    RAISE EXCEPTION 'Cannot erase the only administrator of an organization';
  END IF;

  -- Activity records name people in free-form details (for example {"instructor": "Jane Doe"}).
  -- Replace exact matches of this person's name or email, only within their own organization.
  UPDATE audit_logs
  SET details = (
    SELECT jsonb_object_agg(e.k, CASE WHEN e.v IN (to_jsonb(v_name), to_jsonb(v_email)) THEN to_jsonb(v_redacted) ELSE e.v END)
    FROM jsonb_each(audit_logs.details) AS e(k, v)
  )
  WHERE organization_id = v_org
    AND CASE WHEN jsonb_typeof(details) = 'object'
             THEN EXISTS (SELECT 1 FROM jsonb_each(audit_logs.details) AS e(k, v) WHERE e.v IN (to_jsonb(v_name), to_jsonb(v_email)))
             ELSE false END;

  -- Weekly digests are generated prose and may mention people by name anywhere in their text.
  -- Only names long enough not to match by accident are replaced.
  IF length(v_name) >= 4 THEN
    UPDATE digests
    SET summary = replace(summary, v_name, v_redacted),
        highlights = replace(highlights::text, v_name, v_redacted)::jsonb,
        stats = replace(stats::text, v_name, v_redacted)::jsonb
    WHERE organization_id = v_org
      AND (summary LIKE '%' || v_name || '%' OR highlights::text LIKE '%' || v_name || '%' OR stats::text LIKE '%' || v_name || '%');
  END IF;
  IF length(v_email) >= 4 THEN
    UPDATE digests
    SET summary = replace(summary, v_email, v_redacted),
        highlights = replace(highlights::text, v_email, v_redacted)::jsonb,
        stats = replace(stats::text, v_email, v_redacted)::jsonb
    WHERE organization_id = v_org
      AND (summary LIKE '%' || v_email || '%' OR highlights::text LIKE '%' || v_email || '%' OR stats::text LIKE '%' || v_email || '%');
  END IF;

  -- Keep the work other people did, but stop pointing at this person. (audit_logs.user_id
  -- already becomes NULL by itself.)
  UPDATE assignments SET assigned_by = NULL WHERE assigned_by = p_user;
  UPDATE digests SET generated_by = NULL WHERE generated_by = p_user;

  -- Cascades to their availability, preferences, qualifications, notifications, preferences,
  -- terms acceptance, instructor profile, assignments and any drafts they created.
  DELETE FROM profiles WHERE id = p_user;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.delete_organization_data(UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.erase_person_data(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_organization_data(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.erase_person_data(UUID) TO service_role;

NOTIFY pgrst, 'reload schema';
