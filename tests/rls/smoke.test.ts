// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { createDatabase } from './harness'

describe('migrations', () => {
  it('apply cleanly in order on an empty database', async () => {
    const db = await createDatabase()
    const { rows } = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public'`
    )
    // 15 tenant tables + organizations
    expect(rows[0].n).toBe(16)
  }, 60_000)
})
