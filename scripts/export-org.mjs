// Exports everything an organization owns, for the school to keep (or before deleting it).
//
//   node --env-file=.env.provision scripts/export-org.mjs --slug fraser-valley [--out ./exports/fvc]
//
// Writes a folder of CSV files, a readable schedule.csv, organization.json, manifest.json and a
// README. Default folder: ./exports/<slug>-<date>. Uses the same .env.provision as the other
// scripts. Exports contain personal information: send them over a secure channel, and delete your
// copy when the school confirms receipt. exports/ is git-ignored.

import { parseArgs } from 'node:util'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { exportOrganization } from './exportOrganization.mjs'

const { values } = parseArgs({ options: { slug: { type: 'string' }, out: { type: 'string' } } })

const url = process.env.SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !serviceRoleKey) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (see the comment at the top of this file).')
  process.exit(1)
}
if (!values.slug) {
  console.error('--slug is required (the organization to export).')
  process.exit(1)
}

try {
  const supabase = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })

  const { data: org, error } = await supabase.from('organizations').select('id, name, slug').eq('slug', values.slug).maybeSingle()
  if (error) throw new Error(error.message)
  if (!org) throw new Error(`No organization with slug "${values.slug}"`)

  const { files, manifest } = await exportOrganization(supabase, org)

  const dir = values.out ?? join('exports', `${org.slug}-${manifest.exported_at.slice(0, 10)}`)
  mkdirSync(dir, { recursive: true })
  for (const [name, content] of files) writeFileSync(join(dir, name), content, 'utf8')

  console.log(`Exported ${org.name} to ${dir}`)
  for (const [table, n] of Object.entries(manifest.counts)) console.log(`  ${table.padEnd(26)} ${n}`)
} catch (err) {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
}
