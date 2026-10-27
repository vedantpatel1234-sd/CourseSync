// Writes build/schema.sql: every migration, in order, as one file for a new empty project.
//
//   node scripts/build-schema.mjs
//
// Then open the new project's Supabase SQL editor, paste the contents of build/schema.sql and run it.
// build/ is git-ignored; regenerate whenever a migration is added.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildSchema } from './buildSchema.mjs'

const dir = 'migrations'
const files = readdirSync(dir)
  .filter(name => name.endsWith('.sql')) // the rollback/ folder is a directory, so it is skipped
  .map(name => ({ name, sql: readFileSync(join(dir, name), 'utf8') }))

try {
  const sql = buildSchema(files)
  mkdirSync('build', { recursive: true })
  writeFileSync(join('build', 'schema.sql'), sql, 'utf8')
  console.log(`Wrote build/schema.sql from ${files.length} migrations (${(sql.length / 1024).toFixed(0)} KB).`)
} catch (err) {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
}
