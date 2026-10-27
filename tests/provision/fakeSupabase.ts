// A small in-memory stand-in for the parts of the Supabase client the scripts use:
//   from(t).select(cols, {count, head}).eq(col, v).order(col).range(a, b)   (awaitable)
//   from(t).select(...).eq(...).maybeSingle()
//   rpc(name, args), auth.admin.deleteUser(id)
// Rows are plain objects; it honours eq filters, ordering, ranges and exact counts, which is
// enough to prove pagination and completeness checks behave.

type Row = Record<string, unknown>

export interface FakeOptions {
  /** Make a table's page reads return fewer rows than exist (simulates a truncated export). */
  dropRows?: Record<string, number>
  rpcResult?: { data: unknown; error: { message: string } | null }
  deleteUserErrors?: Record<string, string>
}

export function fakeSupabase(tables: Record<string, Row[]>, options: FakeOptions = {}) {
  const log = { reads: [] as string[], rpc: [] as { name: string; args: unknown }[], deletedUsers: [] as string[] }

  const from = (table: string) => {
    let filters: [string, unknown][] = []
    let orderBy: string | null = null
    let range: [number, number] | null = null
    let head = false
    let wantCount = false

    const run = () => {
      let rows = (tables[table] ?? []).filter(r => filters.every(([c, v]) => r[c] === v))
      const total = rows.length
      if (orderBy) rows = [...rows].sort((a, b) => String(a[orderBy!]).localeCompare(String(b[orderBy!])))
      if (range) rows = rows.slice(range[0], range[1] + 1)
      const dropped = options.dropRows?.[table] ?? 0
      if (!head && dropped > 0 && range) rows = rows.slice(0, Math.max(0, rows.length - dropped))
      log.reads.push(`${table}${head ? ' (count)' : range ? ` [${range[0]}-${range[1]}]` : ''}`)
      return { data: head ? null : rows, count: wantCount ? total : null, error: null }
    }

    const builder = {
      select(_columns?: string, opts?: { count?: string; head?: boolean }) {
        head = !!opts?.head
        wantCount = opts?.count === 'exact'
        return builder
      },
      eq(column: string, value: unknown) { filters = [...filters, [column, value]]; return builder },
      order(column: string) { orderBy = column; return builder },
      range(from: number, to: number) { range = [from, to]; return builder },
      maybeSingle: async () => {
        const { data } = run()
        return { data: data?.[0] ?? null, error: null }
      },
      single: async () => {
        const { data } = run()
        return { data: data?.[0] ?? null, error: null }
      },
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(run()).then(resolve, reject)
    }
    return builder
  }

  const client = {
    from,
    rpc: async (name: string, args: unknown) => {
      log.rpc.push({ name, args })
      return options.rpcResult ?? { data: [], error: null }
    },
    auth: {
      admin: {
        deleteUser: async (id: string) => {
          log.deletedUsers.push(id)
          const message = options.deleteUserErrors?.[id]
          return { error: message ? { message } : null }
        }
      }
    }
  }
  return { client, log }
}
