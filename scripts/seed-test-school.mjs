// Creates a TEST school you can sign in to, to try the app end to end.
//
//   node --env-file=.env.provision scripts/seed-test-school.mjs \
//     --confirm-project <your-project-ref> [--slug test-school] [--app-url https://your-app.example]
//
// It makes one organization ("Test School (safe to delete)") with an administrator, a coordinator
// and two instructors, plus a term, courses, sections, qualifications and one assignment.
//
// The passwords are random and are written ONLY to .test-credentials.local in this folder (git
// ignores *.local). They are never printed. Delete the file when you are done with it.
//
// --confirm-project must equal the project reference in your SUPABASE_URL (the part before
// .supabase.co). It is there so you consciously choose which project gets test accounts. Prefer a
// separate test project; if you use your real one, remove the school afterwards:
//   node --env-file=.env.provision scripts/delete-org.mjs --slug test-school \
//     --confirm-slug test-school --no-export --execute
//
// Uses the same .env.provision as the other scripts (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).

import { parseArgs } from 'node:util'
import { writeFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { seedTestSchool, TEST_SCHOOL_NAME } from './seedTestSchool.mjs'

const { values } = parseArgs({
  options: {
    'confirm-project': { type: 'string' },
    slug: { type: 'string', default: 'test-school' },
    'app-url': { type: 'string' },
    out: { type: 'string', default: '.test-credentials.local' }
  }
})

const url = process.env.SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !serviceRoleKey) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (see the comment at the top of this file).')
  process.exit(1)
}

const projectRef = new URL(url).hostname.split('.')[0]
if (values['confirm-project'] !== projectRef) {
  console.error(`This would add test accounts to the Supabase project "${projectRef}".`)
  console.error(`If that is what you want, add: --confirm-project ${projectRef}`)
  process.exit(1)
}

try {
  const supabase = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { organizationId, credentials } = await seedTestSchool(supabase, { slug: values.slug })

  const lines = [
    `${TEST_SCHOOL_NAME} (slug: ${values.slug}, project: ${projectRef})`,
    values['app-url'] ? `Sign in at: ${values['app-url']}/login` : 'Sign in at your app\'s /login page',
    '',
    ...credentials.flatMap(c => [`${c.role}`, `  email:    ${c.email}`, `  password: ${c.password}`]),
    '',
    'You will be asked to accept the terms the first time each account signs in.',
    '',
    'Remove this school and these accounts when you are finished:',
    `  node --env-file=.env.provision scripts/delete-org.mjs --slug ${values.slug} --confirm-slug ${values.slug} --no-export --execute`,
    ''
  ]
  writeFileSync(values.out, lines.join('\n'), 'utf8')

  console.log(`Created test school ${organizationId} with ${credentials.length} accounts:`)
  for (const c of credentials) console.log(`  ${c.role.padEnd(12)} ${c.email}`)
  console.log(`\nPasswords were written to ${values.out} (not shown here). Delete that file when you are done.`)
} catch (err) {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
}
