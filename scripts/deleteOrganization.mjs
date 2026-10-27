// Safety checks and execution for deleting an entire organization. Used by
// scripts/delete-org.mjs; the Supabase client is passed in so the logic can be tested.
//
// Deletion is irreversible. It runs only when ALL of these hold:
//   1. the slug is typed a second time to confirm,
//   2. an export exists whose manifest matches this organization and is still up to date
//      (or the caller explicitly opts out of that), and
//   3. --execute is passed. Without it the script only reports what it would do.

import { EXPORT_TABLES, countRows } from './exportOrganization.mjs'

/**
 * Returns a list of problems that must be fixed before deleting; empty means safe to proceed.
 * @param opts   { confirmSlug, noExport }
 * @param org    { id, slug }
 * @param manifest the parsed manifest.json of an export, or null
 * @param counts current row counts per table
 */
export function deletionProblems({ confirmSlug, noExport }, org, manifest, counts) {
  const problems = []

  if (confirmSlug !== org.slug) {
    problems.push(`--confirm-slug must be exactly "${org.slug}" to confirm this is the organization you mean`)
  }

  if (noExport) return problems

  if (!manifest) {
    problems.push('No export found. Run scripts/export-org.mjs first and pass its folder as --export-dir (or pass --no-export to delete without one)')
    return problems
  }
  if (manifest.organization_id !== org.id) {
    problems.push('That export belongs to a different organization')
    return problems
  }
  const stale = EXPORT_TABLES.filter(t => (manifest.counts?.[t] ?? -1) !== (counts[t] ?? 0))
  if (stale.length > 0) {
    problems.push(`The export is out of date: ${stale.join(', ')} changed since it was made. Export again`)
  }
  return problems
}

/** Current row counts for every exported table. */
export async function currentCounts(supabase, organizationId) {
  const counts = {}
  for (const table of EXPORT_TABLES) counts[table] = await countRows(supabase, table, organizationId)
  return counts
}

/**
 * Deletes the organization's data in one database transaction, then the login accounts.
 * @returns {{ users: number, failedUsers: {id: string, message: string}[] }}
 */
export async function deleteOrganization(supabase, org) {
  const { data: userIds, error } = await supabase.rpc('delete_organization_data', { p_org: org.id })
  if (error) {
    // The database function is all-or-nothing, so nothing has been removed.
    throw new Error(`Nothing was deleted. The database refused: ${error.message}`)
  }

  const failedUsers = []
  for (const id of userIds ?? []) {
    const { error: authError } = await supabase.auth.admin.deleteUser(id)
    if (authError && !/not found/i.test(authError.message)) failedUsers.push({ id, message: authError.message })
  }
  return { users: (userIds ?? []).length, failedUsers }
}
