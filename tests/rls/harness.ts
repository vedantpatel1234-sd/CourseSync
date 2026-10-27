import { PGlite } from '@electric-sql/pglite'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// Minimal stand-ins for the parts of Supabase the migrations depend on: the auth schema
// (auth.users, auth.uid()) and the anon / authenticated / service_role roles.
const SUPABASE_STUBS = `
  CREATE SCHEMA auth;
  CREATE TABLE auth.users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text);
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
    SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  CREATE ROLE anon NOLOGIN;
  CREATE ROLE authenticated NOLOGIN;
  CREATE ROLE service_role NOLOGIN BYPASSRLS;
  GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
`

// Supabase grants table privileges to these roles by default; RLS is what restricts them.
const SUPABASE_GRANTS = `
  GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
  GRANT ALL ON ALL TABLES IN SCHEMA auth TO service_role;
  GRANT SELECT ON auth.users TO authenticated;
`

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'migrations')

function migrationFiles(): string[] {
  // Rollback scripts live in migrations/rollback/ and are not applied.
  return readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort()
}

/** Applies one migration by its numeric prefix, e.g. applyMigration(db, '010'). */
export async function applyMigration(db: PGlite, prefix: string): Promise<void> {
  const file = migrationFiles().find(f => f.startsWith(`${prefix}_`))
  if (!file) throw new Error(`No migration starting with ${prefix}_`)
  try {
    await db.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'))
  } catch (err) {
    throw new Error(`Migration ${file} failed: ${err instanceof Error ? err.message : err}`, { cause: err })
  }
}

/**
 * A fresh in-memory Postgres. By default every migration is applied; pass `through`
 * (a numeric prefix like '009') to stop early, e.g. to seed legacy data before 010.
 */
export async function createDatabase(opts: { through?: string } = {}): Promise<PGlite> {
  const db = new PGlite()
  await db.exec(SUPABASE_STUBS)
  for (const file of migrationFiles()) {
    const prefix = file.split('_')[0]
    if (opts.through && prefix > opts.through) break
    await applyMigration(db, prefix)
  }
  await db.exec(SUPABASE_GRANTS)
  return db
}

/** Runs `fn` as an authenticated user: RLS applies and auth.uid() returns `userId`. */
export async function asUser<T>(db: PGlite, userId: string, fn: () => Promise<T>): Promise<T> {
  await db.exec(`SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '${userId}', false);`)
  try {
    return await fn()
  } finally {
    await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false);`)
  }
}

/** Runs `fn` as the anon role (a request with only the public key, no session). */
export async function asAnon<T>(db: PGlite, fn: () => Promise<T>): Promise<T> {
  await db.exec(`SET ROLE anon;`)
  try {
    return await fn()
  } finally {
    await db.exec(`RESET ROLE;`)
  }
}

/** Resolves to the error message if `fn` rejects, or null if it succeeds. */
export async function errorOf(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn()
    return null
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}

/** Runs `fn` as the service role: bypasses row-level security, like the Edge Functions and vendor scripts. */
export async function asService<T>(db: PGlite, fn: () => Promise<T>): Promise<T> {
  await db.exec(`SET ROLE service_role;`)
  try {
    return await fn()
  } finally {
    await db.exec(`RESET ROLE;`)
  }
}
