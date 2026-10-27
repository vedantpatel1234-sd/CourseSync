// Sets a school's plan, limits, status and signed-agreement record.
//
//   node --env-file=.env.provision scripts/set-billing.mjs --slug fraser-valley \
//     --plan standard --status active --max-instructors 120 --ai-limit 5000000 \
//     --msa-version 2026-11-01 --msa-signed-at 2026-11-02 --msa-signed-by "Dana Lee"
//
// Other options: --ai on|off, --trial-days N, "unlimited" for either limit.
// Uses the same .env.provision as scripts/provision-org.mjs (SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY). The service-role key bypasses row-level security: keep it on
// your own machine.

import { parseArgs } from 'node:util'
import { createClient } from '@supabase/supabase-js'
import { buildBillingPatch } from './setBilling.mjs'

const { values } = parseArgs({
  options: {
    slug: { type: 'string' },
    plan: { type: 'string' },
    status: { type: 'string' },
    'max-instructors': { type: 'string' },
    'ai-limit': { type: 'string' },
    ai: { type: 'string' },
    'trial-days': { type: 'string' },
    'msa-version': { type: 'string' },
    'msa-signed-at': { type: 'string' },
    'msa-signed-by': { type: 'string' }
  }
})

const url = process.env.SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !serviceRoleKey) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (see the comment at the top of this file).')
  process.exit(1)
}
if (!values.slug) {
  console.error('--slug is required (the organization to change).')
  process.exit(1)
}

try {
  const patch = buildBillingPatch(values)
  const supabase = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })

  const { data: org, error: orgError } = await supabase
    .from('organizations').select('id, name').eq('slug', values.slug).maybeSingle()
  if (orgError) throw new Error(orgError.message)
  if (!org) throw new Error(`No organization with slug "${values.slug}"`)

  const { data: before } = await supabase.from('organization_billing').select('*').eq('organization_id', org.id).single()
  const { data: after, error } = await supabase
    .from('organization_billing').update(patch).eq('organization_id', org.id).select('*').single()
  if (error) throw new Error(error.message)

  console.log(`Updated billing for ${org.name} (${values.slug})`)
  for (const key of Object.keys(patch)) console.log(`  ${key}: ${before?.[key]} -> ${after[key]}`)
} catch (err) {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
}
