// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
// @ts-expect-error - plain ES module script, no type declarations
import { provisionOrganization } from '../../scripts/provisionOrganization.mjs'

const INPUT = {
  name: 'Fraser Valley College',
  slug: 'fraser-valley',
  adminEmail: 'dean@fvc.example',
  adminName: 'Dana Lee',
  redirectTo: 'https://app.example/set-password'
}

interface FakeOptions {
  orgError?: string
  inviteError?: string
  profileError?: string
}

// Records every call so tests can assert on what was created and what was undone.
function fakeSupabase(opts: FakeOptions = {}) {
  const calls: string[] = []
  const client = {
    from: (table: string) => ({
      insert: (row: Record<string, unknown>) => {
        calls.push(`insert ${table} ${JSON.stringify(row)}`)
        const failure = table === 'organizations' ? opts.orgError : opts.profileError
        const result = failure ? { data: null, error: { message: failure } } : { data: { id: `${table}-id` }, error: null }
        return Object.assign(Promise.resolve(result), {
          select: () => ({ single: () => Promise.resolve(result) })
        })
      },
      delete: () => ({
        eq: (col: string, val: string) => {
          calls.push(`delete ${table} where ${col}=${val}`)
          return Promise.resolve({ error: null })
        }
      })
    }),
    auth: {
      admin: {
        inviteUserByEmail: vi.fn(async (email: string, o: { redirectTo: string }) => {
          calls.push(`invite ${email} -> ${o.redirectTo}`)
          return opts.inviteError
            ? { data: { user: null }, error: { message: opts.inviteError } }
            : { data: { user: { id: 'user-1' } }, error: null }
        }),
        deleteUser: vi.fn(async (id: string) => {
          calls.push(`deleteUser ${id}`)
          return { error: null }
        })
      }
    }
  }
  return { client, calls }
}

describe('provisionOrganization', () => {
  it('creates the organization, invites the admin, and stamps the admin profile with that organization', async () => {
    const { client, calls } = fakeSupabase()

    const result = await provisionOrganization(client, INPUT)

    expect(result).toEqual({ organizationId: 'organizations-id', adminId: 'user-1' })
    expect(calls).toEqual([
      'insert organizations {"name":"Fraser Valley College","slug":"fraser-valley"}',
      'invite dean@fvc.example -> https://app.example/set-password',
      'insert profiles {"id":"user-1","full_name":"Dana Lee","email":"dean@fvc.example","role":"admin","organization_id":"organizations-id"}'
    ])
  })

  it('creates nothing further if the organization cannot be created (e.g. slug taken)', async () => {
    const { client, calls } = fakeSupabase({ orgError: 'duplicate key value violates unique constraint' })

    await expect(provisionOrganization(client, INPUT)).rejects.toThrow(/Could not create organization.*duplicate key/)

    expect(client.auth.admin.inviteUserByEmail).not.toHaveBeenCalled()
    expect(calls.filter(c => c.startsWith('delete'))).toEqual([])
  })

  it('removes the organization if the invitation fails', async () => {
    const { client, calls } = fakeSupabase({ inviteError: 'Email rate limit exceeded' })

    await expect(provisionOrganization(client, INPUT)).rejects.toThrow(/Could not invite the admin.*rate limit/)

    expect(calls).toContain('delete organizations where id=organizations-id')
    expect(client.auth.admin.deleteUser).not.toHaveBeenCalled()
  })

  it('removes both the invited user and the organization if the profile cannot be created', async () => {
    const { client, calls } = fakeSupabase({ profileError: 'insert failed' })

    await expect(provisionOrganization(client, INPUT)).rejects.toThrow(/Could not create the admin profile/)

    expect(calls).toContain('deleteUser user-1')
    expect(calls).toContain('delete organizations where id=organizations-id')
  })

  it.each([
    ['a missing name', { name: ' ' }, /name is required/i],
    ['an invalid slug', { slug: 'Has Spaces' }, /Slug must be/],
    ['an invalid admin email', { adminEmail: 'nope' }, /valid admin email/],
    ['a missing admin name', { adminName: '' }, /Admin name is required/]
  ])('rejects %s before touching the database', async (_label, override, message) => {
    const { client, calls } = fakeSupabase()

    await expect(provisionOrganization(client, { ...INPUT, ...override })).rejects.toThrow(message)

    expect(calls).toEqual([])
  })
})
