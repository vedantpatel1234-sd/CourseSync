// Builds a complete export of one organization's data as a set of files (CSV per table, a
// readable schedule, and a manifest). Used by scripts/export-org.mjs; kept free of file and
// network access (the Supabase client is passed in) so it can be tested.
//
// Runs with the service-role key, so it bypasses row-level security: it must only ever be run by
// the vendor, from a trusted machine, for the organization that asked for its data.

// Every table that holds an organization's data. tests/rls/ checks this list against the database
// so a table added later can't be silently left out of exports.
export const EXPORT_TABLES = [
  'profiles', 'instructor_profiles', 'courses', 'terms', 'sections', 'drafts', 'assignments',
  'instructor_availability', 'preferences', 'qualifications', 'notifications',
  'notification_preferences', 'digests', 'audit_logs', 'terms_acceptance', 'ai_usage'
]

const PLAN_FIELDS = [
  'plan', 'subscription_status', 'trial_ends_at', 'max_instructors', 'ai_enabled',
  'ai_monthly_token_limit', 'msa_version', 'msa_signed_at', 'msa_signed_by'
]

const BOM = String.fromCharCode(0xFEFF) // makes Excel read the file as UTF-8, so accented names survive
const FORMULA_START = /^[=+\-@\t\r]/

function cell(value) {
  if (value === null || value === undefined) return ''
  let text
  if (typeof value === 'object') text = JSON.stringify(value)
  else text = String(value)
  // A text value beginning with = + - @ would be run as a formula by spreadsheet programs
  // (CSV injection). Prefix such text with an apostrophe. Numbers and booleans are left alone.
  if (typeof value === 'string' && FORMULA_START.test(text)) text = `'${text}`
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** RFC 4180 CSV with a UTF-8 byte-order mark. Columns default to the first row's keys. */
export function toCsv(rows, columns = rows.length > 0 ? Object.keys(rows[0]) : []) {
  const lines = [columns.map(cell).join(',')]
  for (const row of rows) lines.push(columns.map(c => cell(row[c])).join(','))
  return BOM + lines.join('\r\n') + '\r\n'
}

/** Number of rows an organization has in a table. */
export async function countRows(supabase, table, organizationId) {
  const { count, error } = await supabase
    .from(table).select('id', { count: 'exact', head: true }).eq('organization_id', organizationId)
  if (error) throw new Error(`Could not count ${table}: ${error.message}`)
  return count ?? 0
}

/** Every row of a table for an organization, fetched in pages and checked against a row count. */
export async function fetchAllRows(supabase, table, organizationId, pageSize = 1000) {
  const rows = []
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from(table).select('*').eq('organization_id', organizationId).order('id').range(from, from + pageSize - 1)
    if (error) throw new Error(`Could not read ${table}: ${error.message}`)
    rows.push(...data)
    if (data.length < pageSize) break
  }
  // Guard against a silently truncated export: the rows we hold must equal what the database says exists.
  const expected = await countRows(supabase, table, organizationId)
  if (rows.length !== expected) {
    throw new Error(`Export of ${table} is incomplete: read ${rows.length} rows but the database has ${expected}`)
  }
  return rows
}

/** The live schedule in a form a person can read, with names instead of ids. */
export function buildScheduleRows({ courses, terms, sections, assignments, profiles, instructorProfiles }) {
  const byId = rows => new Map(rows.map(r => [r.id, r]))
  const courseById = byId(courses)
  const termById = byId(terms)
  const sectionById = byId(sections)
  const profileById = byId(profiles)
  const detailsByUser = new Map(instructorProfiles.map(p => [p.user_id, p]))

  return assignments
    .filter(a => a.draft_id === null && a.status !== 'rejected')
    .map(a => {
      const section = sectionById.get(a.section_id)
      const course = section && courseById.get(section.course_id)
      const term = section && termById.get(section.term_id)
      const instructor = profileById.get(a.instructor_id)
      const details = detailsByUser.get(a.instructor_id)
      return {
        term: term?.name ?? '',
        course_code: course?.code ?? '',
        course_name: course?.name ?? '',
        section: section?.section_number ?? '',
        day: section?.day_of_week ?? '',
        time: section?.time_slot ?? '',
        hours_assigned: a.hours_assigned,
        instructor_name: instructor?.full_name ?? '',
        instructor_email: instructor?.email ?? '',
        department: details?.department ?? '',
        title: details?.title ?? ''
      }
    })
    .sort((x, y) =>
      x.term.localeCompare(y.term) || x.course_code.localeCompare(y.course_code) || x.section.localeCompare(y.section))
}

const README = `CourseSync data export

Every file is a CSV (UTF-8; opens in Excel, Numbers and Google Sheets).

  schedule.csv       The live schedule in plain language: term, course, section, day, time and instructor.
  <table>.csv        The raw records, one file per table. Rows refer to each other by id.
  organization.json  Your organization and plan.
  manifest.json      What was exported, when, and how many rows of each table.

Notes
  - Tables with no rows are not written; manifest.json lists every table with its row count.
  - Text that began with = + - or @ has a leading apostrophe added so spreadsheet programs do not
    treat it as a formula. Remove the apostrophe if you load these files into another system.
  - Login passwords are never part of an export; they are not stored in readable form.
`

/**
 * Reads everything for one organization and returns the files to write.
 * @returns {{ files: Map<string, string>, manifest: object }}
 */
export async function exportOrganization(supabase, org, { pageSize = 1000, now = new Date() } = {}) {
  const tables = {}
  for (const table of EXPORT_TABLES) tables[table] = await fetchAllRows(supabase, table, org.id, pageSize)

  const files = new Map()
  const counts = {}
  for (const table of EXPORT_TABLES) {
    counts[table] = tables[table].length
    if (tables[table].length > 0) files.set(`${table}.csv`, toCsv(tables[table]))
  }

  files.set('schedule.csv', toCsv(buildScheduleRows({
    courses: tables.courses, terms: tables.terms, sections: tables.sections,
    assignments: tables.assignments, profiles: tables.profiles, instructorProfiles: tables.instructor_profiles
  }), ['term', 'course_code', 'course_name', 'section', 'day', 'time', 'hours_assigned',
       'instructor_name', 'instructor_email', 'department', 'title']))

  // Only these plan fields are shared with the customer. They are picked here, not just selected
  // in the query, so Stripe identifiers can never leak even if the query changes.
  const { data: billing } = await supabase
    .from('organization_billing').select('*').eq('organization_id', org.id).maybeSingle()
  const plan = billing
    ? Object.fromEntries(PLAN_FIELDS.filter(f => f in billing).map(f => [f, billing[f]]))
    : null
  files.set('organization.json', JSON.stringify({ id: org.id, name: org.name, slug: org.slug, plan }, null, 2) + '\n')

  const manifest = {
    exported_at: now.toISOString(),
    organization_id: org.id,
    organization_slug: org.slug,
    counts
  }
  files.set('manifest.json', JSON.stringify(manifest, null, 2) + '\n')
  files.set('README.txt', README)

  return { files, manifest }
}
