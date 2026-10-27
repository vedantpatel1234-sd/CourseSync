// Shows what has gone wrong for users recently, grouped so repeats are one line.
//
//   node --env-file=.env.provision scripts/recent-errors.mjs                 # last 24 hours
//   node --env-file=.env.provision scripts/recent-errors.mjs --hours 168     # last week
//   node --env-file=.env.provision scripts/recent-errors.mjs --purge         # delete reports older than 30 days
//   node --env-file=.env.provision scripts/recent-errors.mjs --purge 7       # ...or older than 7 days
//
// Uses the same .env.provision as the other scripts. Reports come from the browser app
// (src/lib/errorReporting.ts) and contain scrubbed error text, the page path and the code version,
// plus user and school ids. Run --purge regularly (for example monthly): that is how the 30-day
// retention described in the privacy policy is kept.

import { parseArgs } from 'node:util'
import { createClient } from '@supabase/supabase-js'
import { groupErrors, formatReport } from './recentErrors.mjs'

const { values } = parseArgs({
  options: {
    hours: { type: 'string', default: '24' },
    limit: { type: 'string', default: '2000' },
    purge: { type: 'string' }
  },
  allowPositionals: false,
  strict: false
})

const url = process.env.SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !serviceRoleKey) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (see the comment at the top of this file).')
  process.exit(1)
}

try {
  const supabase = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })

  if ('purge' in values) {
    const days = values.purge === undefined || values.purge === true ? 30 : Number(values.purge)
    if (!Number.isInteger(days) || days < 1) throw new Error('--purge takes a whole number of days, for example --purge 30')
    const { data, error } = await supabase.rpc('purge_old_client_errors', { p_days: days })
    if (error) throw new Error(error.message)
    console.log(`Deleted ${data} error report${data === 1 ? '' : 's'} older than ${days} days.`)
    process.exit(0)
  }

  const hours = Number(values.hours)
  const limit = Number(values.limit)
  if (!Number.isFinite(hours) || hours <= 0) throw new Error('--hours must be a positive number')

  const since = new Date(Date.now() - hours * 3600 * 1000).toISOString()
  const { data, error } = await supabase
    .from('client_errors')
    .select('organization_id, user_id, source, message, stack, path, app_version, created_at')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(error.message)

  process.stdout.write(formatReport(groupErrors(data), { hours, total: data.length }))
  if (data.length === limit) console.log(`(Showing the newest ${limit}; use --limit to see more.)`)
} catch (err) {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
}
