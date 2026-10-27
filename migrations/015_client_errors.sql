-- Error monitoring: a place for the browser app to report the errors users hit, so a bug at a
-- customer is not invisible. Kept in our own database (in the same region as everything else)
-- rather than sent to a third party, so it adds no new provider to the Subprocessors list.
--
--   client_errors  one row per reported error. Write-only for signed-in users: they can report
--                  their own errors but never read anyone's, including their own. You read them
--                  with the service role (scripts/recent-errors.mjs).
--
-- The client scrubs email addresses and token-like strings before sending (src/lib/errorReporting.ts)
-- and never sends request bodies. Size limits below stop a bad actor filling the table; a
-- throttle quietly drops reports from one user beyond 50 an hour; reports older than 30 days are
-- removed by purge_old_client_errors().

BEGIN;

CREATE TABLE client_errors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Stamped from the signed-in user, like the other tenant tables. Cascades with the school.
  organization_id UUID NOT NULL DEFAULT app_org_id() REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID DEFAULT auth.uid() REFERENCES profiles(id) ON DELETE SET NULL,
  source TEXT NOT NULL DEFAULT 'window' CHECK (source IN ('boundary', 'window', 'promise', 'manual')),
  message TEXT NOT NULL CHECK (char_length(message) <= 1000),
  stack TEXT CHECK (stack IS NULL OR char_length(stack) <= 6000),
  path TEXT CHECK (path IS NULL OR char_length(path) <= 300),
  app_version TEXT CHECK (app_version IS NULL OR char_length(app_version) <= 40),
  user_agent TEXT CHECK (user_agent IS NULL OR char_length(user_agent) <= 300),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX client_errors_created_at_idx ON client_errors (created_at DESC);
CREATE INDEX client_errors_organization_created_idx ON client_errors (organization_id, created_at DESC);

ALTER TABLE client_errors ENABLE ROW LEVEL SECURITY;

-- Insert only, and only as yourself. There is deliberately no SELECT policy for users.
CREATE POLICY "client_errors_insert_own" ON client_errors
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

CREATE POLICY tenant_isolation ON client_errors AS RESTRICTIVE FOR ALL TO authenticated
  USING (organization_id = app_org_id())
  WITH CHECK (organization_id = app_org_id());

-- Quietly drops (rather than rejects) reports past 50 an hour from one user. Rejecting would
-- make the app report the failure of reporting, which would loop. SECURITY DEFINER because
-- users cannot read this table, so the count would otherwise always be zero.
CREATE OR REPLACE FUNCTION public.throttle_client_errors()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.user_id IS NOT NULL AND (
    SELECT count(*) FROM client_errors
    WHERE user_id = NEW.user_id AND created_at > now() - interval '1 hour'
  ) >= 50 THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER client_errors_throttle
  BEFORE INSERT ON client_errors
  FOR EACH ROW EXECUTE FUNCTION throttle_client_errors();

-- Removes reports older than the retention period; returns how many. Service role only.
CREATE OR REPLACE FUNCTION public.purge_old_client_errors(p_days INTEGER DEFAULT 30)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  DELETE FROM client_errors WHERE created_at < now() - make_interval(days => p_days);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.purge_old_client_errors(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_old_client_errors(INTEGER) TO service_role;

-- Erasing a person (014) must also remove error reports filed under their account. Same function
-- as before with one extra DELETE.
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

  UPDATE audit_logs
  SET details = (
    SELECT jsonb_object_agg(e.k, CASE WHEN e.v IN (to_jsonb(v_name), to_jsonb(v_email)) THEN to_jsonb(v_redacted) ELSE e.v END)
    FROM jsonb_each(audit_logs.details) AS e(k, v)
  )
  WHERE organization_id = v_org
    AND CASE WHEN jsonb_typeof(details) = 'object'
             THEN EXISTS (SELECT 1 FROM jsonb_each(audit_logs.details) AS e(k, v) WHERE e.v IN (to_jsonb(v_name), to_jsonb(v_email)))
             ELSE false END;

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

  UPDATE assignments SET assigned_by = NULL WHERE assigned_by = p_user;
  UPDATE digests SET generated_by = NULL WHERE generated_by = p_user;

  DELETE FROM client_errors WHERE user_id = p_user;

  DELETE FROM profiles WHERE id = p_user;
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
