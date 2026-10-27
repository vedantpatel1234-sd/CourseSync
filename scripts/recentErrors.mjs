// Turns raw error reports (client_errors) into something you can read: the same error repeated by
// many users becomes one line with a count. Pure, so it can be tested; scripts/recent-errors.mjs
// fetches the rows and prints this.

/** Groups reports by source and message and sorts the most frequent (then most recent) first. */
export function groupErrors(rows) {
  const groups = new Map()
  for (const row of rows) {
    const key = `${row.source}|${row.message}`
    let group = groups.get(key)
    if (!group) {
      group = {
        source: row.source, message: row.message, count: 0,
        users: new Set(), organizations: new Set(), paths: new Map(), versions: new Set(),
        first_seen: row.created_at, last_seen: row.created_at, stack: row.stack ?? null
      }
      groups.set(key, group)
    }
    group.count += 1
    if (row.user_id) group.users.add(row.user_id)
    group.organizations.add(row.organization_id)
    if (row.path) group.paths.set(row.path, (group.paths.get(row.path) ?? 0) + 1)
    if (row.app_version) group.versions.add(row.app_version)
    if (row.created_at < group.first_seen) group.first_seen = row.created_at
    if (row.created_at > group.last_seen) {
      group.last_seen = row.created_at
      group.stack = row.stack ?? group.stack
    }
  }

  return [...groups.values()]
    .map(g => ({
      source: g.source,
      message: g.message,
      count: g.count,
      users: g.users.size,
      organizations: g.organizations.size,
      topPaths: [...g.paths.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([path]) => path),
      versions: [...g.versions].sort(),
      first_seen: g.first_seen,
      last_seen: g.last_seen,
      stack: g.stack
    }))
    .sort((a, b) => b.count - a.count || (a.last_seen < b.last_seen ? 1 : -1))
}

/** A plain-text report, most frequent problems first. */
export function formatReport(groups, { hours, total }) {
  if (groups.length === 0) return `No errors reported in the last ${hours} hours.\n`

  const lines = [`${total} error report${total === 1 ? '' : 's'} in the last ${hours} hours, ${groups.length} distinct:\n`]
  groups.forEach((g, i) => {
    lines.push(
      `${i + 1}. [${g.source}] ${g.message}`,
      `   ${g.count}x · ${g.users} user${g.users === 1 ? '' : 's'} · ${g.organizations} school${g.organizations === 1 ? '' : 's'}` +
        ` · last ${g.last_seen}` + (g.versions.length ? ` · version ${g.versions.join(', ')}` : ''),
      g.topPaths.length ? `   on ${g.topPaths.join(', ')}` : '',
    )
    if (g.stack) lines.push(...g.stack.split('\n').slice(0, 4).map(l => `   | ${l.trim()}`))
    lines.push('')
  })
  return lines.filter((l, i, all) => !(l === '' && all[i - 1] === '')).join('\n') + '\n'
}
