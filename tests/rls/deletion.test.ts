// @vitest-environment node
//
// Data deletion (migration 014): removing a whole organization, and erasing one person.
import { describe, it, expect, beforeEach } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDatabase, asService, asUser, asAnon, errorOf } from './harness'
// @ts-expect-error - plain ES module script, no type declarations
import { EXPORT_TABLES } from '../../scripts/exportOrganization.mjs'
import {
  id, orgA, orgB, adminA, coordA, instA, adminB, instB, stranger, secA, secB, draftB, liveA, draftAssignmentA, seed
} from './fixtures'

describe('data deletion', () => {
  let db: PGlite

  const tenantTables = async () =>
    (await db.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.columns
       WHERE table_schema = 'public' AND column_name = 'organization_id' ORDER BY table_name`)).rows.map(r => r.table_name)

  const countsFor = async (org: string) => {
    const counts: Record<string, number> = {}
    for (const table of await tenantTables()) {
      const { rows } = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table} WHERE organization_id = $1`, [org])
      counts[table] = rows[0].n
    }
    return counts
  }

  beforeEach(async () => {
    db = await createDatabase()
    await seed(db)
  }, 60_000)

  describe('delete_organization_data', () => {
    it('removes every row an organization owns, in every table, and the organization itself', async () => {
      const before = await countsFor(orgA)
      // The fixture populates every table, so "0 afterwards" is meaningful, not vacuous.
      for (const [table, n] of Object.entries(before)) expect(n, `${table} is seeded`).toBeGreaterThan(0)

      await asService(db, () => db.query(`SELECT delete_organization_data($1)`, [orgA]))

      const after = await countsFor(orgA)
      for (const [table, n] of Object.entries(after)) expect(n, `${table} emptied`).toBe(0)
      expect((await db.query(`SELECT 1 FROM organizations WHERE id = $1`, [orgA])).rows).toHaveLength(0)
    })

    it('leaves every other organization completely untouched', async () => {
      const before = await countsFor(orgB)

      await asService(db, () => db.query(`SELECT delete_organization_data($1)`, [orgA]))

      expect(await countsFor(orgB)).toEqual(before)
      expect((await db.query(`SELECT 1 FROM organizations WHERE id = $1`, [orgB])).rows).toHaveLength(1)
    })

    it('returns the login accounts the caller must now remove', async () => {
      const { rows } = await asService(db, () => db.query<{ ids: string[] }>(`SELECT delete_organization_data($1) AS ids`, [orgA]))
      expect([...rows[0].ids].sort()).toEqual([adminA, coordA, instA].sort())
    })

    it('does nothing at all if any step fails (all or nothing)', async () => {
      // A draft assignment in B that points at A's admin (what a forged cross-organization
      // reference would look like) blocks deleting A's profiles via assigned_by.
      await db.query(
        `INSERT INTO assignments (instructor_id, section_id, assigned_by, draft_id, organization_id)
         VALUES ($1, $2, $3, $4, $5)`, [instB, secB, adminA, draftB, orgB])
      const before = await countsFor(orgA)

      const err = await errorOf(() => asService(db, () => db.query(`SELECT delete_organization_data($1)`, [orgA])))

      expect(err).toMatch(/violates foreign key constraint/i)
      expect(await countsFor(orgA)).toEqual(before) // rolled back: nothing was removed
      expect((await db.query(`SELECT 1 FROM organizations WHERE id = $1`, [orgA])).rows).toHaveLength(1)
    })

    it('refuses an organization that does not exist', async () => {
      const err = await errorOf(() => asService(db, () => db.query(`SELECT delete_organization_data($1)`, [id(777)])))
      expect(err).toMatch(/does not exist/)
    })

    it('can only be run by the service role', async () => {
      for (const user of [adminA, stranger]) {
        const denied = await errorOf(() => asUser(db, user, () => db.query(`SELECT delete_organization_data($1)`, [orgA])))
        expect(denied).toMatch(/permission denied/i)
      }
      const anon = await errorOf(() => asAnon(db, () => db.query(`SELECT delete_organization_data($1)`, [orgA])))
      expect(anon).toMatch(/permission denied/i)
      expect((await db.query(`SELECT 1 FROM organizations WHERE id = $1`, [orgA])).rows).toHaveLength(1)
    })

    it('covers every table that has an organization_id, including ones added later', async () => {
      // If someone adds a tenant table and forgets to delete from it here, this fails.
      const { rows } = await db.query<{ def: string }>(
        `SELECT pg_get_functiondef('delete_organization_data(uuid)'::regprocedure) AS def`)
      for (const table of await tenantTables()) {
        if (table === 'organization_billing' || table === 'ai_usage') continue // removed by ON DELETE CASCADE
        expect(rows[0].def, `${table} is deleted`).toContain(`DELETE FROM ${table} `)
      }
    })
  })

  describe('erase_person_data', () => {
    const erase = (user: string) => asService(db, () => db.query(`SELECT erase_person_data($1)`, [user]))
    const personRows = async (table: string, column: string, user: string) =>
      (await db.query(`SELECT 1 FROM ${table} WHERE ${column} = $1`, [user])).rows.length

    it('removes the person and everything keyed to them', async () => {
      await erase(instA)

      for (const [table, column] of [
        ['profiles', 'id'], ['instructor_profiles', 'user_id'], ['assignments', 'instructor_id'],
        ['instructor_availability', 'instructor_id'], ['preferences', 'instructor_id'],
        ['qualifications', 'instructor_id'], ['notifications', 'user_id'],
        ['notification_preferences', 'user_id'], ['terms_acceptance', 'user_id']
      ]) {
        expect(await personRows(table, column, instA), `${table}.${column}`).toBe(0)
      }
    })

    it('leaves everyone else, and the rest of the organization, alone', async () => {
      const before = await countsFor(orgB)
      await erase(instA)

      expect(await countsFor(orgB)).toEqual(before)
      expect(await personRows('profiles', 'id', adminA)).toBe(1)
      expect(await personRows('profiles', 'id', coordA)).toBe(1)
      expect((await db.query(`SELECT 1 FROM courses WHERE organization_id = $1`, [orgA])).rows.length).toBeGreaterThan(0)
    })

    it('puts a section back to unassigned when its only instructor is erased', async () => {
      expect((await db.query<{ status: string }>(`SELECT status FROM sections WHERE id = $1`, [secA])).rows[0].status).toBe('filled')
      await erase(instA)
      expect((await db.query<{ status: string }>(`SELECT status FROM sections WHERE id = $1`, [secA])).rows[0].status).toBe('unassigned')
    })

    it('scrubs the name and email from activity records in their own organization only', async () => {
      await db.query(
        `INSERT INTO audit_logs (user_id, action, entity, details, organization_id) VALUES
           ($1, 'assigned', 'assignment', '{"instructor": "Inst A", "section": "CS101-001"}', $2),
           ($1, 'created', 'instructor', '{"name": "Inst A", "email": "inst@a.test"}', $2),
           ($3, 'assigned', 'assignment', '{"instructor": "Inst A"}', $4)`, [adminA, orgA, adminB, orgB])

      await erase(instA)

      const a = (await db.query<{ details: Record<string, string> }>(
        `SELECT details FROM audit_logs WHERE organization_id = $1 AND details IS NOT NULL ORDER BY created_at, id`, [orgA])).rows.map(r => r.details)
      expect(a).toContainEqual({ instructor: '[deleted user]', section: 'CS101-001' }) // other values kept
      expect(a).toContainEqual({ name: '[deleted user]', email: '[deleted user]' })
      expect(JSON.stringify(a)).not.toContain('Inst A')
      expect(JSON.stringify(a)).not.toContain('inst@a.test')

      // Another college's record that happens to use the same name is not ours to change.
      const b = (await db.query<{ details: Record<string, string> }>(
        `SELECT details FROM audit_logs WHERE organization_id = $1 AND details IS NOT NULL`, [orgB])).rows.map(r => r.details)
      expect(b).toContainEqual({ instructor: 'Inst A' })
    })

    it('does not touch activity records that merely contain similar text', async () => {
      await db.query(
        `INSERT INTO audit_logs (user_id, action, entity, details, organization_id) VALUES
           ($1, 'created', 'course', '{"name": "Inst A Seminar"}', $2),
           ($1, 'imported', 'course', '{"count": 4}', $2)`, [adminA, orgA])
      await erase(instA)
      const rows = (await db.query<{ details: unknown }>(
        `SELECT details FROM audit_logs WHERE entity = 'course' AND organization_id = $1`, [orgA])).rows.map(r => r.details)
      expect(rows).toContainEqual({ name: 'Inst A Seminar' }) // only exact matches are replaced
      expect(rows).toContainEqual({ count: 4 })
    })

    it('scrubs the name from weekly digest text', async () => {
      await db.query(
        `INSERT INTO digests (generated_by, summary, highlights, stats, organization_id)
         VALUES ($1, 'Inst A is overloaded this term.', '["Inst A is at 120% of hours"]', '{"top": "Inst A"}', $2)`, [adminA, orgA])

      await erase(instA)

      const { rows } = await db.query<{ summary: string; highlights: unknown; stats: unknown }>(
        `SELECT summary, highlights, stats FROM digests WHERE summary LIKE '%overloaded%'`)
      expect(rows[0].summary).toBe('[deleted user] is overloaded this term.')
      expect(rows[0].highlights).toEqual(['[deleted user] is at 120% of hours'])
      expect(rows[0].stats).toEqual({ top: '[deleted user]' })
    })

    it('keeps work done by an administrator who is erased, but stops pointing at them', async () => {
      await db.query(`UPDATE assignments SET assigned_by = $1 WHERE id = $2`, [adminA, liveA])
      // A second administrator must exist, otherwise erasing the first is (correctly) refused.
      await db.query(`INSERT INTO auth.users (id, email) VALUES ($1, 'admin2@a.test')`, [id(14)])
      await db.query(`INSERT INTO profiles (id, full_name, email, role, organization_id) VALUES ($1, 'Second Admin', 'admin2@a.test', 'admin', $2)`, [id(14), orgA])
      await erase(adminA)

      const { rows } = await db.query<{ assigned_by: string | null }>(`SELECT assigned_by FROM assignments WHERE id = $1`, [liveA])
      expect(rows).toEqual([{ assigned_by: null }]) // the assignment survives
      expect((await db.query(`SELECT 1 FROM digests WHERE generated_by IS NULL AND organization_id = $1`, [orgA])).rows.length).toBeGreaterThan(0)
      expect(await personRows('profiles', 'id', adminA)).toBe(0)
    })

    it('refuses to erase the only administrator of an organization, and changes nothing', async () => {
      const before = await countsFor(orgB)
      const err = await errorOf(() => erase(adminB))
      expect(err).toMatch(/only administrator/i)
      expect(await countsFor(orgB)).toEqual(before)
    })

    it('does nothing for a person who is already gone', async () => {
      await erase(instA)
      expect(await errorOf(() => erase(instA))).toBeNull()
      expect(await errorOf(() => erase(id(888)))).toBeNull()
    })

    it('can only be run by the service role', async () => {
      const denied = await errorOf(() => asUser(db, adminA, () => db.query(`SELECT erase_person_data($1)`, [instA])))
      expect(denied).toMatch(/permission denied/i)
      expect(await personRows('profiles', 'id', instA)).toBe(1)
    })

    it('leaves the draft assignment an erased instructor had removed with them', async () => {
      await erase(instA)
      expect(await personRows('assignments', 'id', draftAssignmentA)).toBe(0)
    })
  })

  describe('export coverage', () => {
    it('exports every table that holds organization data, and nothing that does not exist', async () => {
      // organization_billing is shared as organization.json (without Stripe ids), not as a CSV.
      const inDatabase = (await tenantTables()).filter(t => t !== 'organization_billing').sort()
      expect([...EXPORT_TABLES].sort()).toEqual(inDatabase)
    })

    it('every exported table has the id and organization_id columns the export reads by', async () => {
      for (const table of EXPORT_TABLES) {
        const { rows } = await db.query<{ column_name: string }>(
          `SELECT column_name FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = $1 AND column_name IN ('id', 'organization_id')`, [table])
        expect(rows.map(r => r.column_name).sort(), table).toEqual(['id', 'organization_id'])
      }
    })
  })
})
