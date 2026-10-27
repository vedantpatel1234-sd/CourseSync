-- Baseline schema: the base tables as they existed before migration 001.
--
-- These were originally created by hand in the Supabase dashboard, so until now a
-- fresh project could not be set up from this folder. Reconstructed from a dump of
-- the live schema (scripts/dump-schema.sql) with the effects of 001, 003, 004, 005
-- (added later by their own migrations) and 006/007 (RLS) removed.
--
-- FRESH PROJECTS ONLY. The existing production database already has all of this;
-- do not run this file there.
--
-- Not included on purpose: the live database also has a public.auto_confirm_email()
-- function that marks every new auth user's email as confirmed. It is not needed (admins
-- create accounts through Edge Functions) and defeats email verification; see
-- docs/multi-tenancy-plan.md.

CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'instructor', 'coordinator')),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE instructor_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
  max_hours_per_term INTEGER NOT NULL DEFAULT 40,
  department TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT ''
);

CREATE TABLE courses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE terms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  is_active BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  term_id UUID NOT NULL REFERENCES terms(id) ON DELETE CASCADE,
  section_number TEXT NOT NULL,
  hours_required INTEGER NOT NULL DEFAULT 3,
  status TEXT NOT NULL DEFAULT 'unassigned' CHECK (status IN ('unassigned', 'partial', 'filled')),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  term_id UUID NOT NULL REFERENCES terms(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'sandbox' CHECK (status IN ('sandbox', 'published')),
  is_ai_generated BOOLEAN DEFAULT false,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instructor_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  section_id UUID NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  hours_assigned INTEGER NOT NULL DEFAULT 3,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'rejected')),
  assigned_by UUID REFERENCES profiles(id),
  draft_id UUID REFERENCES drafts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE instructor_availability (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instructor_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  time_slot TEXT NOT NULL,
  UNIQUE (instructor_id, day, time_slot)
);

CREATE TABLE preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instructor_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  section_id UUID NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  rank INTEGER NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (instructor_id, section_id)
);

CREATE TABLE qualifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instructor_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  verified BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (instructor_id, course_id)
);

CREATE TABLE notification_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
  notify_assigned BOOLEAN DEFAULT true,
  notify_unassigned BOOLEAN DEFAULT true,
  notify_qualification_verified BOOLEAN DEFAULT true
);

CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id UUID,
  details JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE terms_acceptance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  accepted_at TIMESTAMPTZ DEFAULT now(),
  version TEXT NOT NULL DEFAULT '1.0'
);

-- Keeps sections.status in step with its live assignments.
CREATE OR REPLACE FUNCTION public.update_section_status()
RETURNS trigger
LANGUAGE plpgsql
AS $$
declare
  v_section_id uuid;
  v_hours_required integer;
  v_hours_assigned integer;
  v_has_assignment boolean;
begin
  if TG_OP = 'DELETE' then
    v_section_id := OLD.section_id;
  else
    v_section_id := NEW.section_id;
  end if;

  select hours_required into v_hours_required
  from sections where id = v_section_id;

  select coalesce(sum(hours_assigned), 0) into v_hours_assigned
  from assignments
  where section_id = v_section_id
    and draft_id is null
    and status != 'rejected';

  select exists(
    select 1 from assignments
    where section_id = v_section_id
      and draft_id is null
      and status != 'rejected'
  ) into v_has_assignment;

  if not v_has_assignment then
    update sections set status = 'unassigned' where id = v_section_id;
  elsif v_hours_assigned >= v_hours_required then
    update sections set status = 'filled' where id = v_section_id;
  else
    update sections set status = 'partial' where id = v_section_id;
  end if;

  return null;
end;
$$;

CREATE TRIGGER on_assignment_change
  AFTER INSERT OR UPDATE OR DELETE ON assignments
  FOR EACH ROW EXECUTE FUNCTION update_section_status();
