// @vitest-environment node
//
// Runs the real migrations against an in-process Postgres and checks, as actual database
// roles, that one organization can never see or change another's data. The vitest suites
// under src/ mock Supabase, so they cannot prove any of this.
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PGlite } from '@electric-sql/pglite'
import { createDatabase, applyMigration, asUser, asAnon, errorOf } from './harness'

const TENANT_TABLES = [
  'profiles', 'instructor_profiles', 'courses', 'terms', 'sections', 'drafts',
  'assignments', 'instructor_availability', 'preferences', 'qualifications',
  'notifications', 'notification_preferences', 'digests', 'audit_logs', 'terms_acceptance'
]

const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`

const orgA = id(1)
const orgB = id(2)
const adminA = id(11)
const coordA = id(12)
const instA = id(13)
const adminB = id(21)
const instB = id(22)
const stranger = id(99) // signed in, but has no profile

const courseA = id(31)
const courseB = id(32)
const termA = id(41)
const termA2 = id(43)
const termB = id(42)
const secA = id(51)
const secA2 = id(53)
const secB = id(52)
const draftA = id(61)
const draftB = id(62)
const liveA = id(71)
const liveB = id(72)
const draftAssignmentA = id(73)

async function seed(db: PGlite) {
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
  `)
}

const RLS_ERROR = /row-level security/i

describe('tenant isolation', () => {
  let db: PGlite

  const rowsAs = async <T = Record<string, unknown>>(user: string, sql: string, params: unknown[] = []) =>
    (await asUser(db, user, () => db.query<T>(sql, params))).rows

  const orgsSeenAs = async (user: string, table: string) =>
    new Set((await rowsAs<{ organization_id: string }>(user, `SELECT organization_id FROM ${table}`)).map(r => r.organization_id))

  beforeAll(async () => {
    db = await createDatabase()
    await seed(db)
  }, 60_000)

  describe.each(TENANT_TABLES)('%s', table => {
    it('shows an admin only their own organization', async () => {
      const a = await orgsSeenAs(adminA, table)
      expect(a).toEqual(new Set([orgA]))
      const b = await orgsSeenAs(adminB, table)
      expect(b).toEqual(new Set([orgB]))
    })

    it('shows an instructor nothing from another organization', async () => {
      const seen = await orgsSeenAs(instA, table)
      expect(seen.has(orgB)).toBe(false)
    })

    it('shows a signed-in user with no profile nothing', async () => {
      expect(await rowsAs(stranger, `SELECT 1 FROM ${table}`)).toHaveLength(0)
    })

    it('shows an anonymous caller nothing', async () => {
      const { rows } = await asAnon(db, () => db.query(`SELECT 1 FROM ${table}`))
      expect(rows).toHaveLength(0)
    })
  })

  describe('writes across organizations', () => {
    it('rejects an insert that names another organization', async () => {
      const err = await errorOf(() => asUser(db, adminA, () =>
        db.query(`INSERT INTO courses (code, name, organization_id) VALUES ('X1', 'x', $1)`, [orgB])))
      expect(err).toMatch(RLS_ERROR)
    })

    it('stamps an insert that does not name an organization with the caller\'s own', async () => {
      const rows = await rowsAs<{ organization_id: string }>(adminA,
        `INSERT INTO courses (code, name) VALUES ('NEW1', 'New') RETURNING organization_id`)
      expect(rows[0].organization_id).toBe(orgA)
    })

    // Each test pairs the attack with a control that proves the same operation is allowed on
    // the admin's own rows, so a missing role policy can't make a test pass vacuously.
    it('cannot update another organization\'s rows, though it can update its own', async () => {
      const own = await rowsAs(adminA, `UPDATE sections SET hours_required = 4 WHERE id = $1 RETURNING id`, [secA])
      expect(own).toHaveLength(1)
      const other = await rowsAs(adminA, `UPDATE sections SET hours_required = 99 WHERE id = $1 RETURNING id`, [secB])
      expect(other).toHaveLength(0)
      const { rows } = await db.query<{ hours_required: number }>(`SELECT hours_required FROM sections WHERE id = $1`, [secB])
      expect(rows[0].hours_required).toBe(3)
    })

    it('cannot delete another organization\'s rows, though it can delete its own', async () => {
      const [{ id: mine }] = await rowsAs<{ id: string }>(adminA,
        `INSERT INTO courses (code, name) VALUES ('TEMP1', 'temp') RETURNING id`)
      const own = await rowsAs(adminA, `DELETE FROM courses WHERE id = $1 RETURNING id`, [mine])
      expect(own).toHaveLength(1)
      const other = await rowsAs(adminA, `DELETE FROM courses WHERE id = $1 RETURNING id`, [courseB])
      expect(other).toHaveLength(0)
      const { rows } = await db.query(`SELECT 1 FROM courses WHERE id = $1`, [courseB])
      expect(rows).toHaveLength(1)
    })

    it('cannot move its own row into another organization', async () => {
      const err = await errorOf(() => asUser(db, adminA, () =>
        db.query(`UPDATE sections SET organization_id = $1 WHERE id = $2`, [orgB, secA])))
      expect(err).toMatch(RLS_ERROR)
    })

    it('a bulk "deactivate every other term" only touches its own organization', async () => {
      // This is the exact statement Terms.tsx runs when an admin activates a term.
      const changed = await rowsAs<{ id: string }>(adminA,
        `UPDATE terms SET is_active = false WHERE id <> $1 RETURNING id`, [termA])
      expect(changed.map(r => r.id)).toEqual([termA2]) // org A's other term, and nothing of org B's
      const { rows } = await db.query<{ is_active: boolean }>(`SELECT is_active FROM terms WHERE id = $1`, [termB])
      expect(rows[0].is_active).toBe(true)
    })
  })

  describe('role rules still apply inside an organization', () => {
    it('lets an admin create courses but not an instructor or coordinator', async () => {
      for (const user of [instA, coordA]) {
        const err = await errorOf(() => asUser(db, user, () =>
          db.query(`INSERT INTO courses (code, name) VALUES ('NOPE', 'nope')`)))
        expect(err).toMatch(RLS_ERROR)
      }
    })

    it('shows an instructor only their own live assignments', async () => {
      const rows = await rowsAs<{ id: string }>(instA, `SELECT id FROM assignments`)
      expect(rows.map(r => r.id)).toEqual([liveA])
    })

    it('shows a coordinator live assignments but not drafts', async () => {
      const rows = await rowsAs<{ id: string }>(coordA, `SELECT id FROM assignments`)
      expect(rows.map(r => r.id)).toEqual([liveA])
    })

    it('shows an admin live and draft assignments of their own organization', async () => {
      const rows = await rowsAs<{ id: string }>(adminA, `SELECT id FROM assignments ORDER BY id`)
      expect(rows.map(r => r.id)).toEqual([liveA, draftAssignmentA])
    })

    it('still recalculates section status when an admin assigns an instructor', async () => {
      await rowsAs(adminA, `INSERT INTO assignments (instructor_id, section_id) VALUES ($1, $2)`, [instA, secA2])
      const rows = await rowsAs<{ status: string }>(adminA, `SELECT status FROM sections WHERE id = $1`, [secA2])
      expect(rows[0].status).toBe('filled')
    })
  })

  describe('uniqueness is per organization', () => {
    it('allows the same course code in two organizations', async () => {
      const { rows } = await db.query(`SELECT 1 FROM courses WHERE code = 'CS101'`)
      expect(rows).toHaveLength(2)
    })

    it('still rejects a duplicate course code inside one organization', async () => {
      const err = await errorOf(() => asUser(db, adminA, () =>
        db.query(`INSERT INTO courses (code, name) VALUES ('CS101', 'dup')`)))
      expect(err).toMatch(/duplicate key|unique/i)
    })

    it('rejects a second active term in the same organization but not in another', async () => {
      const err = await errorOf(() => asUser(db, adminA, () =>
        db.query(`UPDATE terms SET is_active = true WHERE id = $1`, [termA2])))
      expect(err).toMatch(/duplicate key|unique/i)
      // Org B's own active term was never in conflict.
      const { rows } = await db.query(`SELECT 1 FROM terms WHERE is_active AND organization_id = $1`, [orgB])
      expect(rows).toHaveLength(1)
    })

    it('lets the activate flow (deactivate others, then activate) work', async () => {
      await rowsAs(adminA, `UPDATE terms SET is_active = false WHERE id <> $1`, [termA2])
      await rowsAs(adminA, `UPDATE terms SET is_active = true WHERE id = $1`, [termA2])
      const rows = await rowsAs<{ id: string }>(adminA, `SELECT id FROM terms WHERE is_active`)
      expect(rows.map(r => r.id)).toEqual([termA2])
    })
  })

  describe('terms_acceptance (previously had no row-level security at all)', () => {
    it('lets a user record their own acceptance', async () => {
      const rows = await rowsAs(instA, `INSERT INTO terms_acceptance (user_id) VALUES ($1) RETURNING id`, [instA])
      expect(rows).toHaveLength(1)
    })

    it('rejects recording an acceptance for someone else, even in the same organization', async () => {
      const err = await errorOf(() => asUser(db, instA, () =>
        db.query(`INSERT INTO terms_acceptance (user_id) VALUES ($1)`, [adminA])))
      expect(err).toMatch(RLS_ERROR)
    })

    it('rejects an anonymous insert', async () => {
      const err = await errorOf(() => asAnon(db, () =>
        db.query(`INSERT INTO terms_acceptance (user_id, organization_id) VALUES ($1, $2)`, [instA, orgA])))
      expect(err).toBeTruthy()
    })
  })

  describe('organizations table', () => {
    it('shows a member only their own organization', async () => {
      const rows = await rowsAs<{ id: string }>(instA, `SELECT id FROM organizations`)
      expect(rows.map(r => r.id)).toEqual([orgA])
    })

    it('does not let a member create or rename organizations', async () => {
      const insertErr = await errorOf(() => asUser(db, adminA, () =>
        db.query(`INSERT INTO organizations (name, slug) VALUES ('Evil', 'evil')`)))
      expect(insertErr).toBeTruthy()
      const rows = await rowsAs(adminA, `UPDATE organizations SET name = 'Renamed' WHERE id = $1 RETURNING id`, [orgA])
      expect(rows).toHaveLength(0)
    })
  })

  describe('structure guard', () => {
    it('every public table except organizations has a NOT NULL organization_id, RLS, and a restrictive tenant_isolation policy', async () => {
      const { rows: tables } = await db.query<{ tablename: string; rowsecurity: boolean }>(
        `SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'organizations'`)
      expect(tables.map(t => t.tablename).sort()).toEqual([...TENANT_TABLES].sort())

      for (const { tablename, rowsecurity } of tables) {
        expect(rowsecurity, `${tablename} has RLS enabled`).toBe(true)

        const { rows: cols } = await db.query<{ is_nullable: string }>(
          `SELECT is_nullable FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = $1 AND column_name = 'organization_id'`, [tablename])
        expect(cols, `${tablename} has organization_id`).toHaveLength(1)
        expect(cols[0].is_nullable, `${tablename}.organization_id is NOT NULL`).toBe('NO')

        const { rows: pol } = await db.query(
          `SELECT 1 FROM pg_policies
           WHERE schemaname = 'public' AND tablename = $1 AND policyname = 'tenant_isolation' AND permissive = 'RESTRICTIVE'`, [tablename])
        expect(pol, `${tablename} has a restrictive tenant_isolation policy`).toHaveLength(1)
      }
    })

    it('no policy other than tenant_isolation grants anything to the anon role', async () => {
      const { rows } = await db.query(
        `SELECT tablename, policyname FROM pg_policies WHERE schemaname = 'public' AND 'anon' = ANY (roles)`)
      expect(rows).toHaveLength(0)
    })
  })
})

describe('upgrading an existing single-school database (migrations 010 and 011)', () => {
  const seedLegacy = async (db: PGlite) => {
    await db.exec(`
      INSERT INTO auth.users (id, email) VALUES ('${adminA}', 'admin@old.test'), ('${instA}', 'inst@old.test');
      INSERT INTO profiles (id, full_name, email, role) VALUES
        ('${adminA}', 'Old Admin', 'admin@old.test', 'admin'), ('${instA}', 'Old Inst', 'inst@old.test', 'instructor');
      INSERT INTO courses (id, code, name) VALUES ('${courseA}', 'CS101', 'Intro');
      INSERT INTO terms (id, name, start_date, end_date, is_active) VALUES ('${termA}', 'Fall', '2026-09-01', '2026-12-15', true);
      INSERT INTO sections (id, course_id, term_id, section_number) VALUES ('${secA}', '${courseA}', '${termA}', '001');
      INSERT INTO assignments (instructor_id, section_id) VALUES ('${instA}', '${secA}');
      INSERT INTO terms_acceptance (user_id) VALUES ('${adminA}');
    `)
  }

  it('moves every existing row into one founding organization and keeps it all visible to its admin', async () => {
    const db = await createDatabase({ through: '009' })
    await seedLegacy(db)
    await applyMigration(db, '010')
    await applyMigration(db, '011')

    const { rows: orgs } = await db.query<{ id: string; name: string }>(`SELECT id, name FROM organizations`)
    expect(orgs).toHaveLength(1)
    expect(orgs[0].name).toBe('Founding Organization')

    for (const table of TENANT_TABLES) {
      const { rows } = await db.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM ${table} WHERE organization_id IS DISTINCT FROM $1`, [orgs[0].id])
      expect(rows[0].n, `${table} fully backfilled`).toBe(0)
    }

    // The existing admin keeps seeing everything after the upgrade.
    const courses = (await asUser(db, adminA, () => db.query(`SELECT 1 FROM courses`))).rows
    const profiles = (await asUser(db, adminA, () => db.query(`SELECT 1 FROM profiles`))).rows
    expect(courses).toHaveLength(1)
    expect(profiles).toHaveLength(2)
  }, 60_000)

  it('stops with a clear message if more than one term is active', async () => {
    const db = await createDatabase({ through: '009' })
    await db.exec(`
      INSERT INTO terms (name, start_date, end_date, is_active) VALUES
        ('Fall', '2026-09-01', '2026-12-15', true), ('Winter', '2027-01-05', '2027-04-15', true);
    `)
    await expect(applyMigration(db, '010')).rejects.toThrow(/More than one term is marked active/)
  }, 60_000)

  it('creates no organization on a brand-new empty database', async () => {
    const db = await createDatabase()
    const { rows } = await db.query(`SELECT 1 FROM organizations`)
    expect(rows).toHaveLength(0)
  }, 60_000)

  it('can be rolled back: the rollback script removes the isolation policies', async () => {
    const db = await createDatabase()
    await db.exec(readFileSync(join(__dirname, '..', '..', 'migrations', 'rollback', '011_down.sql'), 'utf8'))
    const { rows } = await db.query(`SELECT 1 FROM pg_policies WHERE policyname = 'tenant_isolation'`)
    expect(rows).toHaveLength(0)
  }, 60_000)
})
