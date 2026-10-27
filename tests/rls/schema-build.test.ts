// @vitest-environment node
//
// The single-file schema used to bootstrap a new project (staging) must produce exactly the same
// database as applying the migrations one at a time, which is what production went through.
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PGlite } from '@electric-sql/pglite'
import { createDatabase, createBareDatabase, grantSupabaseDefaults } from './harness'
// @ts-expect-error - plain ES module script, no type declarations
import { buildSchema } from '../../scripts/buildSchema.mjs'

const MIGRATIONS = join(__dirname, '..', '..', 'migrations')

// Everything structural about the public schema, in a stable order, so two databases can be compared.
async function describeSchema(db: PGlite) {
  const q = async (sql: string) => (await db.query<Record<string, unknown>>(sql)).rows
  return {
    tables: await q(`SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`),
    columns: await q(`SELECT table_name, column_name, data_type, is_nullable, column_default
                      FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, column_name`),
    constraints: await q(`SELECT conrelid::regclass::text AS tbl, conname, pg_get_constraintdef(oid) AS def
                          FROM pg_constraint WHERE connamespace = 'public'::regnamespace ORDER BY 1, 2`),
    indexes: await q(`SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' ORDER BY 1, 2`),
    policies: await q(`SELECT tablename, policyname, permissive, roles::text, cmd, qual, with_check
                       FROM pg_policies WHERE schemaname = 'public' ORDER BY 1, 2`),
    functions: await q(`SELECT proname, pg_get_functiondef(oid) AS def FROM pg_proc
                        WHERE pronamespace = 'public'::regnamespace ORDER BY 1`),
    triggers: await q(`SELECT event_object_table, trigger_name, event_manipulation, action_timing
                       FROM information_schema.triggers WHERE trigger_schema = 'public' ORDER BY 1, 2, 3`),
    grants: await q(`SELECT routine_name, grantee, privilege_type FROM information_schema.routine_privileges
                     WHERE routine_schema = 'public' ORDER BY 1, 2, 3`)
  }
}

describe('build/schema.sql', () => {
  it('builds exactly the same database as applying the migrations one by one', async () => {
    const files = readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql')).map(name => ({ name, sql: readFileSync(join(MIGRATIONS, name), 'utf8') }))

    const incremental = await createDatabase()

    const bootstrapped = await createBareDatabase()
    await bootstrapped.exec(buildSchema(files))
    await grantSupabaseDefaults(bootstrapped)

    const [a, b] = [await describeSchema(incremental), await describeSchema(bootstrapped)]
    expect(a.tables.length).toBeGreaterThan(15) // sanity: we really compared a populated schema
    expect(b).toEqual(a)
  }, 120_000)
})
