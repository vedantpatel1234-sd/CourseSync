// Onboards a new school: creates the organization and emails its first admin an invitation.
//
//   node --env-file=.env.provision scripts/provision-org.mjs \
//     --name "Fraser Valley College" --slug fraser-valley \
//     --admin-email dean@fvc.example --admin-name "Dana Lee" \
//     --redirect https://your-app.example/set-password
//
// .env.provision (git-ignored by the .env* rule) must contain:
//   SUPABASE_URL=https://<project>.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY=<service role key>
//
// The service-role key bypasses all row-level security. Keep it on your own machine; never
// put it in the app, in Vercel's VITE_* variables, or in chat.

import { parseArgs } from 'node:util'
import { createClient } from '@supabase/supabase-js'
import { provisionOrganization } from './provisionOrganization.mjs'

const { values } = parseArgs({
  options: {
    name: { type: 'string' },
    slug: { type: 'string' },
    'admin-email': { type: 'string' },
    'admin-name': { type: 'string' },
    redirect: { type: 'string' }
  }
})

const url = process.env.SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !serviceRoleKey) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (see the comment at the top of this file).')
  process.exit(1)
}

const supabase = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })

try {
  const result = await provisionOrganization(supabase, {
    name: values.name,
    slug: values.slug,
    adminEmail: values['admin-email'],
    adminName: values['admin-name'],
    redirectTo: values.redirect
  })
  console.log(`Created organization ${result.organizationId}`)
  console.log(`Invitation sent to ${values['admin-email']} (admin ${result.adminId})`)
} catch (err) {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
}
