// @vitest-environment node
//
// Error reports (migration 015): who can write them, that nobody can read them back, the size
// limits, the throttle, and the purge.
import { describe, it, expect, beforeEach } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDatabase, asUser, asAnon, asService, errorOf } from './harness'
import { orgA, orgB, adminA, coordA, instA, adminB, stranger, seed } from './fixtures'

describe('client error reports', () => {
  let db: PGlite

  const report = (user: string, message = 'boom', extra: Record<string, unknown> = {}) =>
    asUser(db, user, () => db.query(
      `INSERT INTO client_errors (message, stack, path, source, app_version, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [message, extra.stack ?? null, extra.path ?? '/admin', extra.source ?? 'window', extra.app_version ?? 'abc123', extra.user_agent ?? 'Mozilla']))

  const stored = async (where = 'true', params: unknown[] = []) =>
    (await db.query<Record<string, unknown>>(`SELECT * FROM client_errors WHERE ${where} ORDER BY created_at`, params)).rows

  beforeEach(async () => {
    db = await createDatabase()
    await seed(db)
    await db.exec(`DELETE FROM client_errors`) // start each test with a clean table
  }, 60_000)

  describe('who can report', () => {
    it('lets every kind of signed-in user report an error, stamped with their own user and organization', async () => {
      for (const user of [adminA, coordA, instA]) await report(user, `error from ${user}`)

      const rows = await stored()
      expect(rows).toHaveLength(3)
      for (const row of rows) {
        expect(row.organization_id).toBe(orgA)
        expect(typeof row.user_id).toBe('string')
      }
      expect(rows.map(r => r.user_id).sort()).toEqual([adminA, coordA, instA].sort())
    })

    it('does not let anyone read error reports back, not even their own', async () => {
      await report(adminA, 'mine')
      expect(await asUser(db, adminA, () => db.query(`SELECT * FROM client_errors`)).then(r => r.rows)).toHaveLength(0)
      expect(await asUser(db, adminB, () => db.query(`SELECT * FROM client_errors`)).then(r => r.rows)).toHaveLength(0)
      expect(await stored()).toHaveLength(1) // it is there, just not readable by users
    })

    it('does not let a user file a report in someone else\'s name', async () => {
      const err = await errorOf(() => asUser(db, instA, () => db.query(
        `INSERT INTO client_errors (user_id, message) VALUES ($1, 'forged')`, [adminA])))
      expect(err).toMatch(/row-level security/i)
    })

    it('does not let a user file a report into another organization', async () => {
      const err = await errorOf(() => asUser(db, adminA, () => db.query(
        `INSERT INTO client_errors (organization_id, message) VALUES ($1, 'sneaky')`, [orgB])))
      expect(err).toMatch(/row-level security/i)
      expect(await stored()).toHaveLength(0)
    })

    it('does not let users change or delete reports', async () => {
      await report(adminA, 'keep me')
      expect(await asUser(db, adminA, () => db.query(`UPDATE client_errors SET message = 'x' RETURNING 1`)).then(r => r.rows)).toHaveLength(0)
      expect(await asUser(db, adminA, () => db.query(`DELETE FROM client_errors RETURNING 1`)).then(r => r.rows)).toHaveLength(0)
      expect((await stored())[0].message).toBe('keep me')
    })

    it('does not accept reports from a signed-in user with no profile, or from anonymous callers', async () => {
      expect(await errorOf(() => report(stranger))).toBeTruthy()
      const anon = await errorOf(() => asAnon(db, () => db.query(`INSERT INTO client_errors (message) VALUES ('x')`)))
      expect(anon).toBeTruthy()
      expect(await stored()).toHaveLength(0)
    })
  })

  describe('size limits', () => {
    it('accepts reports at the limit', async () => {
      await report(adminA, 'm'.repeat(1000), { stack: 's'.repeat(6000), path: 'p'.repeat(300), app_version: 'v'.repeat(40), user_agent: 'u'.repeat(300) })
      expect(await stored()).toHaveLength(1)
    })

    it.each([
      ['message', { message: 'm'.repeat(1001) }],
      ['stack', { stack: 's'.repeat(6001) }],
      ['path', { path: 'p'.repeat(301) }],
      ['app_version', { app_version: 'v'.repeat(41) }],
      ['user_agent', { user_agent: 'u'.repeat(301) }]
    ])('rejects an oversized %s', async (_field, over) => {
      const { message, ...extra } = over as { message?: string }
      const err = await errorOf(() => report(adminA, message ?? 'ok', extra))
      expect(err).toMatch(/check constraint|violates/i)
      expect(await stored()).toHaveLength(0)
    })

    it('rejects an unknown source', async () => {
      const err = await errorOf(() => report(adminA, 'x', { source: 'telepathy' }))
      expect(err).toMatch(/check constraint|violates/i)
    })
  })

  describe('throttle', () => {
    it('quietly drops reports beyond 50 an hour from one user, without raising an error', async () => {
      await asUser(db, instA, async () => {
        for (let i = 0; i < 55; i++) await db.query(`INSERT INTO client_errors (message) VALUES ($1)`, [`e${i}`])
      })
      expect(await stored('user_id = $1', [instA])).toHaveLength(50)
    })

    it('does not let one noisy user use up anyone else\'s allowance', async () => {
      await asUser(db, instA, async () => {
        for (let i = 0; i < 52; i++) await db.query(`INSERT INTO client_errors (message) VALUES ('noise')`)
      })
      await report(adminA, 'a real problem')
      expect(await stored('user_id = $1', [adminA])).toHaveLength(1)
    })

    it('only counts the last hour, so a quiet user can report again later', async () => {
      await db.query(
        `INSERT INTO client_errors (organization_id, user_id, message, created_at)
         SELECT $1, $2, 'old', now() - interval '2 hours' FROM generate_series(1, 60)`, [orgA, instA])
      await report(instA, 'fresh')
      expect(await stored(`user_id = $1 AND message = 'fresh'`, [instA])).toHaveLength(1)
    })
  })

  describe('purge_old_client_errors', () => {
    beforeEach(async () => {
      await db.query(
        `INSERT INTO client_errors (organization_id, user_id, message, created_at) VALUES
           ($1, $2, 'ancient', now() - interval '45 days'),
           ($1, $2, 'old', now() - interval '31 days'),
           ($1, $2, 'recent', now() - interval '29 days'),
           ($1, $2, 'new', now())`, [orgA, adminA])
    })

    it('removes reports older than 30 days by default, returns how many, and keeps the rest', async () => {
      const { rows } = await asService(db, () => db.query<{ n: number }>(`SELECT purge_old_client_errors() AS n`))
      expect(rows[0].n).toBe(2)
      expect((await stored()).map(r => r.message)).toEqual(['recent', 'new'])
    })

    it('takes a custom number of days', async () => {
      await asService(db, () => db.query(`SELECT purge_old_client_errors(7)`))
      expect((await stored()).map(r => r.message)).toEqual(['new'])
    })

    it('can only be run by the service role', async () => {
      for (const user of [adminA, instA]) {
        const err = await errorOf(() => asUser(db, user, () => db.query(`SELECT purge_old_client_errors()`)))
        expect(err).toMatch(/permission denied/i)
      }
      expect(await stored()).toHaveLength(4)
    })
  })

  describe('erasing a person', () => {
    it('also removes the error reports filed under their account, and no one else\'s', async () => {
      await report(instA, 'theirs')
      await report(adminA, 'someone else\'s')

      await asService(db, () => db.query(`SELECT erase_person_data($1)`, [instA]))

      expect((await stored()).map(r => r.message)).toEqual(['someone else\'s'])
    })
  })
})
