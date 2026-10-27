// @vitest-environment node
//
// Billing and AI-usage tables (migration 012): defaults, who can read and write them, and the
// monthly usage function the ai-proxy relies on.
import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDatabase, applyMigration, asUser, errorOf } from './harness'

const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const orgA = id(1)
const orgB = id(2)
const adminA = id(11)
const coordA = id(12)
const instA = id(13)
const adminB = id(21)

describe('billing and AI usage', () => {
  let db: PGlite

  const rowsAs = async <T = Record<string, unknown>>(user: string, sql: string, params: unknown[] = []) =>
    (await asUser(db, user, () => db.query<T>(sql, params))).rows

  beforeAll(async () => {
    db = await createDatabase()
    await db.exec(`
      INSERT INTO organizations (id, name, slug) VALUES ('${orgA}', 'College A', 'a'), ('${orgB}', 'College B', 'b');
      INSERT INTO auth.users (id, email) VALUES
        ('${adminA}', 'admin@a.test'), ('${coordA}', 'coord@a.test'), ('${instA}', 'inst@a.test'), ('${adminB}', 'admin@b.test');
      INSERT INTO profiles (id, full_name, email, role, organization_id) VALUES
        ('${adminA}', 'Admin A', 'admin@a.test', 'admin', '${orgA}'),
        ('${coordA}', 'Coord A', 'coord@a.test', 'coordinator', '${orgA}'),
        ('${instA}', 'Inst A', 'inst@a.test', 'instructor', '${orgA}'),
        ('${adminB}', 'Admin B', 'admin@b.test', 'admin', '${orgB}');
    `)
  }, 60_000)

  describe('defaults for a new organization', () => {
    it('starts on a 30-day trial with the default limits, created automatically', async () => {
      const { rows } = await db.query<{
        plan: string; subscription_status: string; max_instructors: number
        ai_enabled: boolean; ai_monthly_token_limit: string; days_left: number
      }>(`SELECT plan, subscription_status, max_instructors, ai_enabled, ai_monthly_token_limit,
                 round(extract(epoch FROM (trial_ends_at - now())) / 86400)::int AS days_left
          FROM organization_billing WHERE organization_id = $1`, [orgA])
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        plan: 'trial', subscription_status: 'trial', max_instructors: 25, ai_enabled: true, days_left: 30
      })
      expect(Number(rows[0].ai_monthly_token_limit)).toBe(1_000_000)
    })

    it('rejects an unknown subscription status', async () => {
      const err = await errorOf(() => db.query(
        `UPDATE organization_billing SET subscription_status = 'free-for-all' WHERE organization_id = $1`, [orgA]))
      expect(err).toMatch(/check constraint|violates/i)
    })

    it('bumps updated_at when a row changes', async () => {
      await db.query(`UPDATE organization_billing SET updated_at = now() - interval '1 day' WHERE organization_id = $1`, [orgB])
      // The touch trigger overrides the manual value, so this proves it fired on UPDATE.
      const { rows } = await db.query<{ recent: boolean }>(
        `SELECT updated_at > now() - interval '1 minute' AS recent FROM organization_billing WHERE organization_id = $1`, [orgB])
      expect(rows[0].recent).toBe(true)
    })
  })

  describe('who can see and change billing data', () => {
    it('lets an admin read their own organization\'s billing row, and only that', async () => {
      const rows = await rowsAs<{ organization_id: string }>(adminA, `SELECT organization_id FROM organization_billing`)
      expect(rows.map(r => r.organization_id)).toEqual([orgA])
    })

    it('hides billing rows and AI usage from instructors and coordinators', async () => {
      for (const user of [instA, coordA]) {
        expect(await rowsAs(user, `SELECT 1 FROM organization_billing`)).toHaveLength(0)
        expect(await rowsAs(user, `SELECT 1 FROM ai_usage`)).toHaveLength(0)
      }
    })

    it('does not let an admin change their own plan or limits', async () => {
      // Control: the table is writable by a privileged role, so a no-op result below is the policy.
      const privileged = await db.query(
        `UPDATE organization_billing SET max_instructors = 30 WHERE organization_id = $1 RETURNING 1`, [orgA])
      expect(privileged.rows).toHaveLength(1)

      const upgrade = await rowsAs(adminA,
        `UPDATE organization_billing SET max_instructors = NULL, ai_monthly_token_limit = NULL,
                subscription_status = 'active' WHERE organization_id = $1 RETURNING 1`, [orgA])
      expect(upgrade).toHaveLength(0)
      const { rows } = await db.query<{ max_instructors: number }>(
        `SELECT max_instructors FROM organization_billing WHERE organization_id = $1`, [orgA])
      expect(rows[0].max_instructors).toBe(30)
    })

    it('does not let an admin insert or delete billing rows', async () => {
      const insertErr = await errorOf(() => asUser(db, adminA, () => db.query(
        `INSERT INTO organization_billing (organization_id) VALUES ($1)`, [orgA])))
      expect(insertErr).toBeTruthy()
      const deleted = await rowsAs(adminA, `DELETE FROM organization_billing WHERE organization_id = $1 RETURNING 1`, [orgA])
      expect(deleted).toHaveLength(0)
    })

    it('does not let an admin write or erase AI usage records', async () => {
      const insertErr = await errorOf(() => asUser(db, adminA, () => db.query(
        `INSERT INTO ai_usage (organization_id, model, input_tokens) VALUES ($1, 'm', 1)`, [orgA])))
      expect(insertErr).toMatch(/row-level security/i)
      const deleted = await rowsAs(adminA, `DELETE FROM ai_usage RETURNING 1`)
      expect(deleted).toHaveLength(0)
    })
  })

  describe('ai_tokens_used_this_month', () => {
    beforeAll(async () => {
      await db.exec(`
        DELETE FROM ai_usage;
        INSERT INTO ai_usage (organization_id, model, input_tokens, output_tokens, created_at) VALUES
          ('${orgA}', 'm', 100, 50, now()),
          ('${orgA}', 'm', 10, 5, date_trunc('month', now() AT TIME ZONE 'utc') AT TIME ZONE 'utc'),
          ('${orgA}', 'm', 9999, 9999, (date_trunc('month', now() AT TIME ZONE 'utc') AT TIME ZONE 'utc') - interval '1 second'),
          ('${orgB}', 'm', 7777, 7777, now());
      `)
    })

    it('sums input and output tokens for the organization since the start of the UTC month', async () => {
      const { rows } = await db.query<{ n: string }>(`SELECT ai_tokens_used_this_month($1) AS n`, [orgA])
      expect(Number(rows[0].n)).toBe(165) // 150 + 15; the row one second before the month began is excluded
    })

    it('returns zero for an organization with no usage', async () => {
      await db.exec(`INSERT INTO organizations (id, name, slug) VALUES ('${id(3)}', 'College C', 'c')`)
      const { rows } = await db.query<{ n: string }>(`SELECT ai_tokens_used_this_month($1) AS n`, [id(3)])
      expect(Number(rows[0].n)).toBe(0)
    })

    it('lets an admin see their own total but never another organization\'s', async () => {
      const own = await rowsAs<{ n: string }>(adminA, `SELECT ai_tokens_used_this_month($1) AS n`, [orgA])
      expect(Number(own[0].n)).toBe(165)
      const other = await rowsAs<{ n: string }>(adminA, `SELECT ai_tokens_used_this_month($1) AS n`, [orgB])
      expect(Number(other[0].n)).toBe(0)
    })
  })

  it('removes billing rows and usage when an organization is deleted', async () => {
    await db.exec(`INSERT INTO organizations (id, name, slug) VALUES ('${id(4)}', 'College D', 'd')`)
    await db.exec(`INSERT INTO ai_usage (organization_id, model) VALUES ('${id(4)}', 'm')`)
    await db.exec(`DELETE FROM organizations WHERE id = '${id(4)}'`)
    expect((await db.query(`SELECT 1 FROM organization_billing WHERE organization_id = $1`, [id(4)])).rows).toHaveLength(0)
    expect((await db.query(`SELECT 1 FROM ai_usage WHERE organization_id = $1`, [id(4)])).rows).toHaveLength(0)
  })
})

describe('upgrading an existing database to billing (migration 012)', () => {
  it('gives the founding organization an active, unlimited "internal" plan, not a trial', async () => {
    const db = await createDatabase({ through: '009' })
    await db.exec(`
      INSERT INTO auth.users (id, email) VALUES ('${adminA}', 'admin@old.test');
      INSERT INTO profiles (id, full_name, email, role) VALUES ('${adminA}', 'Old Admin', 'admin@old.test', 'admin');
    `)
    await applyMigration(db, '010')
    await applyMigration(db, '011')
    await applyMigration(db, '012')

    const { rows } = await db.query<{
      plan: string; subscription_status: string; max_instructors: number | null
      ai_monthly_token_limit: string | null; trial_ends_at: string | null
    }>(`SELECT plan, subscription_status, max_instructors, ai_monthly_token_limit, trial_ends_at FROM organization_billing`)
    expect(rows).toEqual([{
      plan: 'internal', subscription_status: 'active', max_instructors: null,
      ai_monthly_token_limit: null, trial_ends_at: null
    }])
  }, 60_000)
})
