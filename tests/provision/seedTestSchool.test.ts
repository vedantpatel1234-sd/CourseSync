// @vitest-environment node
import { describe, it, expect } from 'vitest'
import {
  seedTestSchool, generatePassword, TEST_SCHOOL_NAME, formatCredentialsFile, parseCredentialsFile
// @ts-expect-error - plain ES module script, no type declarations
} from '../../scripts/seedTestSchool.mjs'
import { validatePassword } from '../../src/lib/passwordRules'

type Row = Record<string, unknown>

interface FakeOptions { existingSlug?: boolean; failTable?: string; failCreateUserAt?: number }

function makeFake(opts: FakeOptions = {}) {
  const calls = {
    inserts: [] as { table: string; rows: Row | Row[] }[],
    updates: [] as { table: string; patch: Row }[],
    rpc: [] as { name: string; args: unknown }[],
    createdUsers: [] as { email: string; password: string; email_confirm: boolean }[],
    deletedUsers: [] as string[]
  }
  let userCount = 0

  const client = {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: opts.existingSlug ? { id: 'existing' } : null, error: null }) })
      }),
      insert: (rows: Row | Row[]) => {
        calls.inserts.push({ table, rows })
        const result = opts.failTable === table
          ? { data: null, error: { message: `${table} insert failed` } }
          : { data: { id: 'org-new' }, error: null }
        return Object.assign(Promise.resolve(result), { select: () => ({ single: async () => result }) })
      },
      update: (patch: Row) => ({
        eq: async () => {
          calls.updates.push({ table, patch })
          return { error: opts.failTable === `${table}:update` ? { message: `${table} update failed` } : null }
        }
      })
    }),
    rpc: async (name: string, args: unknown) => {
      calls.rpc.push({ name, args })
      return { data: [], error: null }
    },
    auth: {
      admin: {
        createUser: async (user: { email: string; password: string; email_confirm: boolean }) => {
          userCount += 1
          if (opts.failCreateUserAt === userCount) return { data: { user: null }, error: { message: 'user creation failed' } }
          calls.createdUsers.push(user)
          return { data: { user: { id: `user-${userCount}` } }, error: null }
        },
        deleteUser: async (id: string) => { calls.deletedUsers.push(id); return { error: null } }
      }
    }
  }
  return { client, calls }
}

const rowsOf = (calls: ReturnType<typeof makeFake>['calls'], table: string) =>
  calls.inserts.filter(i => i.table === table).flatMap(i => (Array.isArray(i.rows) ? i.rows : [i.rows]))

let counter = 0
const passwords = () => `Aa1-test-${++counter}`

describe('generatePassword', () => {
  it('meets the app\'s own password rules and is long enough to be strong', () => {
    for (let i = 0; i < 50; i++) {
      const pw = generatePassword()
      expect(validatePassword(pw)).toBeNull()
      expect(pw.length).toBeGreaterThanOrEqual(16)
    }
  })

  it('is different every time', () => {
    expect(new Set(Array.from({ length: 100 }, generatePassword)).size).toBe(100)
  })
})

describe('seedTestSchool', () => {
  it('creates one account per role, with confirmed emails, and returns their credentials', async () => {
    const { client, calls } = makeFake()
    const result = await seedTestSchool(client, { slug: 'test-school', makePassword: passwords })

    expect(result.organizationId).toBe('org-new')
    expect(result.credentials.map((c: { role: string }) => c.role)).toEqual(['admin', 'coordinator', 'instructor1', 'instructor2'])
    expect(result.credentials.map((c: { email: string }) => c.email)).toEqual([
      'admin@test-school.example', 'coordinator@test-school.example',
      'instructor1@test-school.example', 'instructor2@test-school.example'
    ])
    expect(calls.createdUsers.every(u => u.email_confirm === true)).toBe(true)
    // Each account's password is the one reported for it, and they are all different.
    expect(result.credentials.map((c: { password: string }) => c.password)).toEqual(calls.createdUsers.map(u => u.password))
    expect(new Set(calls.createdUsers.map(u => u.password)).size).toBe(4)
  })

  it('gives each account the right role, inside the new school', async () => {
    const { client, calls } = makeFake()
    await seedTestSchool(client, { makePassword: passwords })

    const profiles = rowsOf(calls, 'profiles')
    expect(profiles.map(p => p.role)).toEqual(['admin', 'coordinator', 'instructor', 'instructor'])
    expect(profiles.every(p => p.organization_id === 'org-new')).toBe(true)
    expect(rowsOf(calls, 'instructor_profiles')).toHaveLength(2) // instructors only
  })

  it('puts every row of sample data inside the test school and nowhere else', async () => {
    const { client, calls } = makeFake()
    await seedTestSchool(client, { makePassword: passwords })

    const tenantTables = ['profiles', 'instructor_profiles', 'terms', 'courses', 'sections', 'qualifications', 'instructor_availability', 'assignments']
    for (const table of tenantTables) {
      const rows = rowsOf(calls, table)
      expect(rows.length, table).toBeGreaterThan(0)
      expect(rows.every(r => r.organization_id === 'org-new'), table).toBe(true)
    }
  })

  it('leaves the test school unrestricted so testing is never blocked by a plan limit', async () => {
    const { client, calls } = makeFake()
    await seedTestSchool(client, { makePassword: passwords })

    expect(calls.updates).toContainEqual({
      table: 'organization_billing',
      patch: { plan: 'test', subscription_status: 'active', max_instructors: null, ai_monthly_token_limit: null }
    })
  })

  it('creates a current term and leaves some sections unassigned for the assigning screens to use', async () => {
    const { client, calls } = makeFake()
    await seedTestSchool(client, { now: new Date('2026-11-15T00:00:00Z'), makePassword: passwords })

    const term = rowsOf(calls, 'terms')[0] as { is_active: boolean; start_date: string; end_date: string }
    expect(term.is_active).toBe(true)
    expect(term.start_date < '2026-11-15' && '2026-11-15' < term.end_date).toBe(true)
    expect(rowsOf(calls, 'sections')).toHaveLength(4)
    expect(rowsOf(calls, 'assignments')).toHaveLength(1)
  })

  it('refuses to run if the slug is already taken, creating nothing', async () => {
    const { client, calls } = makeFake({ existingSlug: true })

    await expect(seedTestSchool(client, { slug: 'test-school' })).rejects.toThrow(/already exists/)

    expect(calls.inserts).toEqual([])
    expect(calls.createdUsers).toEqual([])
  })

  it('labels the school as a test so it is never mistaken for a customer', async () => {
    const { client, calls } = makeFake()
    await seedTestSchool(client, { makePassword: passwords })
    expect(rowsOf(calls, 'organizations')[0]).toMatchObject({ name: TEST_SCHOOL_NAME, slug: 'test-school' })
    expect(TEST_SCHOOL_NAME).toMatch(/safe to delete/i)
  })

  describe('when something fails part-way', () => {
    it('removes the school\'s data and every account already created', async () => {
      const { client, calls } = makeFake({ failTable: 'sections' })

      await expect(seedTestSchool(client, { makePassword: passwords })).rejects.toThrow(/Could not add sections.*Nothing was left behind/)

      expect(calls.rpc).toEqual([{ name: 'delete_organization_data', args: { p_org: 'org-new' } }])
      expect([...calls.deletedUsers].sort()).toEqual(['user-1', 'user-2', 'user-3', 'user-4'])
    })

    it('cleans up the accounts made so far when an account itself cannot be created', async () => {
      const { client, calls } = makeFake({ failCreateUserAt: 3 })

      await expect(seedTestSchool(client, { makePassword: passwords })).rejects.toThrow(/Could not create the instructor1 account/)

      expect(calls.rpc).toHaveLength(1)
      expect([...calls.deletedUsers].sort()).toEqual(['user-1', 'user-2'])
    })

    it('cleans up when the billing update fails', async () => {
      const { client, calls } = makeFake({ failTable: 'organization_billing:update' })

      await expect(seedTestSchool(client, { makePassword: passwords })).rejects.toThrow(/set up billing/)

      expect(calls.rpc).toHaveLength(1)
      expect(calls.createdUsers).toEqual([]) // failed before any account was made
    })

    it('says the migrations may be missing when the school itself cannot be created', async () => {
      const { client, calls } = makeFake({ failTable: 'organizations' })

      await expect(seedTestSchool(client, { makePassword: passwords })).rejects.toThrow(/migrations 010-014/)

      expect(calls.createdUsers).toEqual([])
      expect(calls.rpc).toEqual([]) // there is no school to clean up
    })
  })
})

describe('credentials file', () => {
  const credentials = [
    { role: 'admin', email: 'admin@test-school.example', password: 'Aa1-xyz_ABC123' },
    { role: 'coordinator', email: 'coordinator@test-school.example', password: 'Aa1-other-pass' },
    { role: 'instructor1', email: 'instructor1@test-school.example', password: 'Aa1abc' },
    { role: 'instructor2', email: 'instructor2@test-school.example', password: 'Aa1def' }
  ]
  const file = (appUrl?: string) => formatCredentialsFile({ slug: 'test-school', projectRef: 'abcd1234', appUrl, credentials })

  it('can be read back exactly as written', () => {
    expect(parseCredentialsFile(file('https://app.example'))).toEqual({
      admin: { email: 'admin@test-school.example', password: 'Aa1-xyz_ABC123' },
      coordinator: { email: 'coordinator@test-school.example', password: 'Aa1-other-pass' },
      instructor1: { email: 'instructor1@test-school.example', password: 'Aa1abc' },
      instructor2: { email: 'instructor2@test-school.example', password: 'Aa1def' }
    })
  })

  it('tells the reader where to sign in and how to remove the school', () => {
    expect(file('https://app.example')).toContain('Sign in at: https://app.example/login')
    expect(file()).toContain('/login page')
    expect(file()).toContain('delete-org.mjs --slug test-school --confirm-slug test-school --no-export --execute')
  })

  it('reads Windows line endings too', () => {
    expect(parseCredentialsFile(file().replace(/\n/g, '\r\n')).admin.email).toBe('admin@test-school.example')
  })

  it('returns nothing for text that is not a credentials file', () => {
    expect(parseCredentialsFile('hello\nworld')).toEqual({})
    expect(parseCredentialsFile('')).toEqual({})
  })
})
