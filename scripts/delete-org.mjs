// Permanently deletes an organization and everything it owns, including its login accounts.
// THIS CANNOT BE UNDONE (apart from restoring a database backup).
//
//   # 1. Export first and give the school its data:
//   node --env-file=.env.provision scripts/export-org.mjs --slug fraser-valley
//   # 2. See what would be deleted (changes nothing):
//   node --env-file=.env.provision scripts/delete-org.mjs --slug fraser-valley \
//     --confirm-slug fraser-valley --export-dir exports/fraser-valley-2027-03-01
//   # 3. Actually delete (same command plus --execute):
//   ... --execute
//
// It refuses to run unless the slug is confirmed, the export is for this organization and still
// matches the live data, and --execute is given. --no-export skips the export check (only for an
// organization that has no data worth keeping). Uses the same .env.provision as the other scripts.

import { parseArgs } from 'node:util'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { currentCounts, deletionProblems, deleteOrganization } from './deleteOrganization.mjs'

const { values } = parseArgs({
  options: {
    slug: { type: 'string' },
    'confirm-slug': { type: 'string' },
    'export-dir': { type: 'string' },
    'no-export': { type: 'boolean', default: false },
    execute: { type: 'boolean', default: false }
  }
})

const url = process.env.SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !serviceRoleKey) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (see the comment at the top of this file).')
  process.exit(1)
}
if (!values.slug) {
  console.error('--slug is required (the organization to delete).')
  process.exit(1)
}

function readManifest(dir) {
  if (!dir) return null
  try {
    return JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))
  } catch {
    return null
  }
}

try {
  const supabase = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })

  const { data: org, error } = await supabase.from('organizations').select('id, name, slug').eq('slug', values.slug).maybeSingle()
  if (error) throw new Error(error.message)
  if (!org) throw new Error(`No organization with slug "${values.slug}"`)

  const counts = await currentCounts(supabase, org.id)
  console.log(`Organization: ${org.name} (${org.slug})`)
  for (const [table, n] of Object.entries(counts)) console.log(`  ${table.padEnd(26)} ${n}`)

  const problems = deletionProblems(
    { confirmSlug: values['confirm-slug'], noExport: values['no-export'] },
    org, readManifest(values['export-dir']), counts
  )
  if (problems.length > 0) {
    console.error('\nNot deleting:')
    for (const p of problems) console.error(`  - ${p}`)
    process.exit(1)
  }

  if (!values.execute) {
    console.log('\nAll checks passed. Nothing has been deleted. Add --execute to delete this organization permanently.')
    process.exit(0)
  }

  const result = await deleteOrganization(supabase, org)
  console.log(`\nDeleted ${org.name}: its data and ${result.users - result.failedUsers.length} of ${result.users} login accounts.`)
  if (result.failedUsers.length > 0) {
    console.error('These login accounts could not be removed and must be deleted by hand (Supabase dashboard -> Authentication):')
    for (const f of result.failedUsers) console.error(`  ${f.id}: ${f.message}`)
    process.exit(2)
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
}
