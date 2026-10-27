// Creates a clearly-labelled TEST school with one account per role and a little sample data, so
// the app can be tried end to end. Used by scripts/seed-test-school.mjs; the Supabase client is
// passed in so the logic can be tested.
//
// Runs with the service-role key (bypasses row-level security). Accounts get random passwords that
// are returned to the caller, never logged. Everything is inside one organization, so it is removed
// completely with scripts/delete-org.mjs.

import { randomBytes, randomUUID } from 'node:crypto'

export const TEST_SCHOOL_NAME = 'Test School (safe to delete)'

/** A random password that also satisfies the app's own rules (length, upper case, a number). */
export function generatePassword() {
  return `Aa1${randomBytes(12).toString('base64url')}`
}

const DAY = 24 * 60 * 60 * 1000
const isoDate = d => d.toISOString().slice(0, 10)

/**
 * @returns {{ organizationId: string, credentials: {role: string, email: string, password: string}[] }}
 */
export async function seedTestSchool(supabase, { slug = 'test-school', now = new Date(), makePassword = generatePassword } = {}) {
  const { data: existing } = await supabase.from('organizations').select('id').eq('slug', slug).maybeSingle()
  if (existing) {
    throw new Error(`An organization with slug "${slug}" already exists. Delete it first (scripts/delete-org.mjs) or choose another --slug`)
  }

  const { data: org, error: orgError } = await supabase
    .from('organizations').insert({ name: TEST_SCHOOL_NAME, slug }).select('id').single()
  if (orgError) throw new Error(`Could not create the test school: ${orgError.message}. Have migrations 010-014 been run?`)
  const organization_id = org.id

  const createdUsers = []
  const credentials = []

  // Undo everything created so far, so a failed run leaves nothing behind.
  const rollback = async () => {
    await supabase.rpc('delete_organization_data', { p_org: organization_id })
    for (const id of createdUsers) await supabase.auth.admin.deleteUser(id)
  }
  const check = async (error, what) => {
    if (error) {
      await rollback()
      throw new Error(`Could not ${what}: ${error.message}. Nothing was left behind`)
    }
  }

  // A test school should never get in your way: active, no limits.
  const billing = await supabase.from('organization_billing')
    .update({ plan: 'test', subscription_status: 'active', max_instructors: null, ai_monthly_token_limit: null })
    .eq('organization_id', organization_id)
  await check(billing.error, 'set up billing')

  const people = [
    { role: 'admin', name: 'Test Admin' },
    { role: 'coordinator', name: 'Test Coordinator' },
    { role: 'instructor', name: 'Test Instructor One', department: 'Computer Science', title: 'Professor' },
    { role: 'instructor', name: 'Test Instructor Two', department: 'Mathematics', title: 'Lecturer' }
  ]
  const instructorsSeen = { n: 0 }
  const users = []
  for (const person of people) {
    const label = person.role === 'instructor' ? `instructor${++instructorsSeen.n}` : person.role
    const email = `${label}@${slug}.example`
    const password = makePassword()

    const { data, error } = await supabase.auth.admin.createUser({ email, password, email_confirm: true })
    if (error || !data?.user) await check(error ?? { message: 'no user returned' }, `create the ${label} account`)
    createdUsers.push(data.user.id)

    const profile = await supabase.from('profiles').insert({
      id: data.user.id, full_name: person.name, email, role: person.role, organization_id
    })
    await check(profile.error, `create the ${label} profile`)

    if (person.role === 'instructor') {
      const details = await supabase.from('instructor_profiles').insert({
        user_id: data.user.id, organization_id, department: person.department, title: person.title, max_hours_per_term: 12
      })
      await check(details.error, `create the ${label} details`)
    }

    users.push({ ...person, id: data.user.id })
    credentials.push({ role: label, email, password })
  }
  const [admin, , instructorOne, instructorTwo] = users

  const termId = randomUUID()
  const courses = [
    { id: randomUUID(), code: 'CS101', name: 'Introduction to Programming', department: 'Computer Science' },
    { id: randomUUID(), code: 'MATH110', name: 'Calculus I', department: 'Mathematics' },
    { id: randomUUID(), code: 'ENGL101', name: 'Academic Writing', department: 'English' }
  ]
  const sections = [
    { id: randomUUID(), course_id: courses[0].id, section_number: '001', day_of_week: 'Monday', time_slot: '9:00 AM' },
    { id: randomUUID(), course_id: courses[0].id, section_number: '002', day_of_week: 'Wednesday', time_slot: '1:00 PM' },
    { id: randomUUID(), course_id: courses[1].id, section_number: '001', day_of_week: 'Tuesday', time_slot: '10:00 AM' },
    { id: randomUUID(), course_id: courses[2].id, section_number: '001', day_of_week: 'Thursday', time_slot: '2:00 PM' }
  ]

  const writes = [
    ['set up the term', supabase.from('terms').insert({
      id: termId, name: 'Test Term', start_date: isoDate(new Date(now.getTime() - 14 * DAY)),
      end_date: isoDate(new Date(now.getTime() + 90 * DAY)), is_active: true, organization_id
    })],
    ['add courses', supabase.from('courses').insert(courses.map(c => ({ ...c, organization_id })))],
    ['add sections', supabase.from('sections').insert(sections.map(s => ({
      ...s, term_id: termId, hours_required: 3, organization_id
    })))],
    ['add qualifications', supabase.from('qualifications').insert([
      { instructor_id: instructorOne.id, course_id: courses[0].id, verified: true, organization_id },
      { instructor_id: instructorOne.id, course_id: courses[1].id, verified: false, organization_id },
      { instructor_id: instructorTwo.id, course_id: courses[1].id, verified: true, organization_id },
      { instructor_id: instructorTwo.id, course_id: courses[2].id, verified: true, organization_id }
    ])],
    ['add availability', supabase.from('instructor_availability').insert([
      { instructor_id: instructorOne.id, day: 'Monday', time_slot: '9:00 AM', organization_id },
      { instructor_id: instructorOne.id, day: 'Wednesday', time_slot: '1:00 PM', organization_id },
      { instructor_id: instructorTwo.id, day: 'Tuesday', time_slot: '10:00 AM', organization_id }
    ])],
    // One section is already assigned; the others are left open so the matching and assigning
    // screens have something to do.
    ['add an assignment', supabase.from('assignments').insert({
      instructor_id: instructorOne.id, section_id: sections[0].id, hours_assigned: 3,
      status: 'active', assigned_by: admin.id, organization_id
    })]
  ]
  for (const [what, write] of writes) await check((await write).error, what)

  return { organizationId: organization_id, credentials }
}
