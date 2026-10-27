// @vitest-environment node
import { describe, it, expect } from 'vitest'
// @ts-expect-error - plain ES module script, no type declarations
import { deletionProblems, deleteOrganization, currentCounts } from '../../scripts/deleteOrganization.mjs'
// @ts-expect-error - plain ES module script, no type declarations
import { EXPORT_TABLES } from '../../scripts/exportOrganization.mjs'
import { fakeSupabase } from './fakeSupabase'

const ORG = { id: 'org-1', name: 'Fraser Valley College', slug: 'fraser-valley' }

const zeroCounts = () => Object.fromEntries(EXPORT_TABLES.map((t: string) => [t, 0]))
const counts = (over: Record<string, number> = {}) => ({ ...zeroCounts(), courses: 4, profiles: 3, ...over })
const manifestFor = (c: Record<string, number>, orgId = ORG.id) => ({ organization_id: orgId, counts: c })

describe('deletionProblems', () => {
  it('passes when the slug is confirmed and a matching, current export exists', () => {
    const c = counts()
    expect(deletionProblems({ confirmSlug: 'fraser-valley', noExport: false }, ORG, manifestFor(c), c)).toEqual([])
  })

  it('requires the slug to be typed exactly', () => {
    const c = counts()
    for (const wrong of [undefined, '', 'fraser', 'Fraser-Valley', 'fraser-valley ']) {
      const problems = deletionProblems({ confirmSlug: wrong, noExport: false }, ORG, manifestFor(c), c)
      expect(problems.join(' ')).toMatch(/--confirm-slug must be exactly "fraser-valley"/)
    }
  })

  it('refuses without an export', () => {
    const problems = deletionProblems({ confirmSlug: 'fraser-valley', noExport: false }, ORG, null, counts())
    expect(problems.join(' ')).toMatch(/No export found/)
  })

  it('refuses an export that belongs to a different organization', () => {
    const c = counts()
    const problems = deletionProblems({ confirmSlug: 'fraser-valley', noExport: false }, ORG, manifestFor(c, 'someone-else'), c)
    expect(problems.join(' ')).toMatch(/different organization/)
  })

  it('refuses an export that is out of date, naming what changed', () => {
    const exported = counts()
    const live = counts({ courses: 5, notifications: 2 })
    const problems = deletionProblems({ confirmSlug: 'fraser-valley', noExport: false }, ORG, manifestFor(exported), live)
    expect(problems.join(' ')).toMatch(/out of date: courses, notifications changed/)
  })

  it('treats a table missing from the manifest as out of date, not as fine', () => {
    const c = counts()
    const manifest = manifestFor(c)
    delete (manifest.counts as Record<string, number>).assignments
    const problems = deletionProblems({ confirmSlug: 'fraser-valley', noExport: false }, ORG, manifest, counts({ assignments: 0 }))
    expect(problems.join(' ')).toMatch(/assignments/)
  })

  it('lets --no-export skip the export check, but never the slug check', () => {
    expect(deletionProblems({ confirmSlug: 'fraser-valley', noExport: true }, ORG, null, counts())).toEqual([])
    const wrong = deletionProblems({ confirmSlug: 'nope', noExport: true }, ORG, null, counts())
    expect(wrong.join(' ')).toMatch(/--confirm-slug/)
  })

  it('reports every problem at once', () => {
    const problems = deletionProblems({ confirmSlug: 'x', noExport: false }, ORG, null, counts())
    expect(problems).toHaveLength(2)
  })
})

describe('currentCounts', () => {
  it('counts only the organization\'s rows in every exported table', async () => {
    const { client } = fakeSupabase({
      courses: [{ id: '1', organization_id: 'org-1' }, { id: '2', organization_id: 'org-1' }, { id: '3', organization_id: 'org-2' }]
    })
    const result = await currentCounts(client, 'org-1')
    expect(result.courses).toBe(2)
    expect(result.profiles).toBe(0)
    expect(Object.keys(result).sort()).toEqual([...EXPORT_TABLES].sort())
  })
})

describe('deleteOrganization', () => {
  it('asks the database to delete the organization, then removes each login account', async () => {
    const { client, log } = fakeSupabase({}, { rpcResult: { data: ['u1', 'u2', 'u3'], error: null } })

    const result = await deleteOrganization(client, ORG)

    expect(log.rpc).toEqual([{ name: 'delete_organization_data', args: { p_org: 'org-1' } }])
    expect(log.deletedUsers).toEqual(['u1', 'u2', 'u3'])
    expect(result).toEqual({ users: 3, failedUsers: [] })
  })

  it('removes no login accounts if the database refuses (nothing was deleted)', async () => {
    const { client, log } = fakeSupabase({}, { rpcResult: { data: null, error: { message: 'violates foreign key constraint' } } })

    await expect(deleteOrganization(client, ORG)).rejects.toThrow(/Nothing was deleted.*foreign key/)

    expect(log.deletedUsers).toEqual([])
  })

  it('reports accounts it could not remove so they can be cleaned up by hand', async () => {
    const { client } = fakeSupabase({}, {
      rpcResult: { data: ['u1', 'u2'], error: null },
      deleteUserErrors: { u2: 'service unavailable' }
    })

    const result = await deleteOrganization(client, ORG)

    expect(result.failedUsers).toEqual([{ id: 'u2', message: 'service unavailable' }])
  })

  it('does not count an already-deleted account as a failure', async () => {
    const { client } = fakeSupabase({}, {
      rpcResult: { data: ['u1'], error: null },
      deleteUserErrors: { u1: 'User not found' }
    })
    expect((await deleteOrganization(client, ORG)).failedUsers).toEqual([])
  })

  it('handles an organization with no users', async () => {
    const { client, log } = fakeSupabase({}, { rpcResult: { data: [], error: null } })
    expect(await deleteOrganization(client, ORG)).toEqual({ users: 0, failedUsers: [] })
    expect(log.deletedUsers).toEqual([])
  })
})
