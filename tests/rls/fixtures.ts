import type { PGlite } from '@electric-sql/pglite'

// Two organizations with a row in every table, shared by the isolation and deletion suites.
// Organization A has an admin, a coordinator and an instructor; B has an admin and an instructor.
// `stranger` is a signed-in user with no profile at all.

export const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`

export const orgA = id(1)
export const orgB = id(2)
export const adminA = id(11)
export const coordA = id(12)
export const instA = id(13)
export const adminB = id(21)
export const instB = id(22)
export const stranger = id(99) // signed in, but has no profile

export const courseA = id(31)
export const courseB = id(32)
export const termA = id(41)
export const termA2 = id(43)
export const termB = id(42)
export const secA = id(51)
export const secA2 = id(53)
export const secB = id(52)
export const draftA = id(61)
export const draftB = id(62)
export const liveA = id(71)
export const liveB = id(72)
export const draftAssignmentA = id(73)

export async function seed(db: PGlite) {
  await db.exec(`
    INSERT INTO organizations (id, name, slug) VALUES
      ('${orgA}', 'College A', 'a'), ('${orgB}', 'College B', 'b');

    INSERT INTO auth.users (id, email) VALUES
      ('${adminA}', 'admin@a.test'), ('${coordA}', 'coord@a.test'), ('${instA}', 'inst@a.test'),
      ('${adminB}', 'admin@b.test'), ('${instB}', 'inst@b.test'), ('${stranger}', 'nobody@x.test');

    INSERT INTO profiles (id, full_name, email, role, organization_id) VALUES
      ('${adminA}', 'Admin A', 'admin@a.test', 'admin', '${orgA}'),
      ('${coordA}', 'Coord A', 'coord@a.test', 'coordinator', '${orgA}'),
      ('${instA}', 'Inst A', 'inst@a.test', 'instructor', '${orgA}'),
      ('${adminB}', 'Admin B', 'admin@b.test', 'admin', '${orgB}'),
      ('${instB}', 'Inst B', 'inst@b.test', 'instructor', '${orgB}');

    INSERT INTO instructor_profiles (user_id, organization_id) VALUES
      ('${instA}', '${orgA}'), ('${instB}', '${orgB}');

    -- Both colleges use the same course code: legal once uniqueness is per organization.
    INSERT INTO courses (id, code, name, organization_id) VALUES
      ('${courseA}', 'CS101', 'Intro A', '${orgA}'), ('${courseB}', 'CS101', 'Intro B', '${orgB}');

    INSERT INTO terms (id, name, start_date, end_date, is_active, organization_id) VALUES
      ('${termA}', 'Fall A', '2026-09-01', '2026-12-15', true, '${orgA}'),
      ('${termA2}', 'Winter A', '2027-01-05', '2027-04-15', false, '${orgA}'),
      ('${termB}', 'Fall B', '2026-09-01', '2026-12-15', true, '${orgB}');

    INSERT INTO sections (id, course_id, term_id, section_number, organization_id) VALUES
      ('${secA}', '${courseA}', '${termA}', '001', '${orgA}'),
      ('${secA2}', '${courseA}', '${termA}', '002', '${orgA}'),
      ('${secB}', '${courseB}', '${termB}', '001', '${orgB}');

    INSERT INTO drafts (id, name, term_id, created_by, organization_id) VALUES
      ('${draftA}', 'Draft A', '${termA}', '${adminA}', '${orgA}'),
      ('${draftB}', 'Draft B', '${termB}', '${adminB}', '${orgB}');

    INSERT INTO assignments (id, instructor_id, section_id, draft_id, organization_id) VALUES
      ('${liveA}', '${instA}', '${secA}', NULL, '${orgA}'),
      ('${liveB}', '${instB}', '${secB}', NULL, '${orgB}'),
      ('${draftAssignmentA}', '${instA}', '${secA2}', '${draftA}', '${orgA}');

    INSERT INTO instructor_availability (instructor_id, day, time_slot, organization_id) VALUES
      ('${instA}', 'Monday', '8:00 AM', '${orgA}'), ('${instB}', 'Monday', '8:00 AM', '${orgB}');
    INSERT INTO preferences (instructor_id, section_id, rank, organization_id) VALUES
      ('${instA}', '${secA}', 1, '${orgA}'), ('${instB}', '${secB}', 1, '${orgB}');
    INSERT INTO qualifications (instructor_id, course_id, organization_id) VALUES
      ('${instA}', '${courseA}', '${orgA}'), ('${instB}', '${courseB}', '${orgB}');

    INSERT INTO notifications (user_id, type, message, organization_id) VALUES
      ('${adminA}', 't', 'm', '${orgA}'), ('${instA}', 't', 'm', '${orgA}'),
      ('${adminB}', 't', 'm', '${orgB}'), ('${instB}', 't', 'm', '${orgB}');
    INSERT INTO notification_preferences (user_id, organization_id) VALUES
      ('${adminA}', '${orgA}'), ('${instA}', '${orgA}'), ('${adminB}', '${orgB}'), ('${instB}', '${orgB}');
    INSERT INTO digests (generated_by, summary, highlights, stats, organization_id) VALUES
      ('${adminA}', 's', '[]', '{}', '${orgA}'), ('${adminB}', 's', '[]', '{}', '${orgB}');
    INSERT INTO audit_logs (user_id, action, entity, organization_id) VALUES
      ('${adminA}', 'created', 'course', '${orgA}'), ('${adminB}', 'created', 'course', '${orgB}');
    INSERT INTO terms_acceptance (user_id, organization_id) VALUES
      ('${adminA}', '${orgA}'), ('${instA}', '${orgA}'), ('${adminB}', '${orgB}'), ('${instB}', '${orgB}');
    INSERT INTO ai_usage (organization_id, user_id, model, input_tokens, output_tokens) VALUES
      ('${orgA}', '${adminA}', 'm', 10, 20), ('${orgB}', '${adminB}', 'm', 10, 20);
  `)
}
