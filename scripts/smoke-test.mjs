// Checks a deployed environment end to end: sign-in, database policies, all three Edge Functions,
// and (optionally) the website itself. Safe to run against staging, and against production with a
// test school: every check is a request that must be refused or rejected, so nothing is invited,
// deleted or sent to the AI.
//
//   node --env-file=.env.provision scripts/smoke-test.mjs --credentials .test-credentials.local \
//     --app-url https://your-staging-app.example
//
// .env.provision needs SUPABASE_URL and SUPABASE_ANON_KEY (the public anon key, the same value as
// VITE_SUPABASE_ANON_KEY). The credentials file is the one scripts/seed-test-school.mjs writes.
// Exits with a non-zero status if anything fails, so it can gate a deployment.

import { parseArgs } from 'node:util'
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { parseCredentialsFile } from './seedTestSchool.mjs'
import { runSmokeTests, runSiteChecks, formatResults } from './smokeTest.mjs'

const { values } = parseArgs({
  options: {
    credentials: { type: 'string', default: '.test-credentials.local' },
    'app-url': { type: 'string' }
  }
})

const url = process.env.SUPABASE_URL
const anonKey = process.env.SUPABASE_ANON_KEY
if (!url || !anonKey) {
  console.error('Set SUPABASE_URL and SUPABASE_ANON_KEY (see the comment at the top of this file).')
  process.exit(1)
}

let credentials
try {
  credentials = parseCredentialsFile(readFileSync(values.credentials, 'utf8'))
} catch {
  console.error(`Could not read ${values.credentials}. Create a test school first: node scripts/seed-test-school.mjs`)
  process.exit(1)
}

console.log(`Checking ${new URL(url).hostname}${values['app-url'] ? ` and ${values['app-url']}` : ''}\n`)

const makeClient = () => createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
const results = [
  ...(values['app-url'] ? await runSiteChecks({ appUrl: values['app-url'] }) : []),
  ...(await runSmokeTests({ makeClient, credentials }))
]

const { text, ok } = formatResults(results)
process.stdout.write(text)
process.exit(ok ? 0 : 1)
