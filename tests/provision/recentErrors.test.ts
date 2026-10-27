// @vitest-environment node
import { describe, it, expect } from 'vitest'
// @ts-expect-error - plain ES module script, no type declarations
import { groupErrors, formatReport } from '../../scripts/recentErrors.mjs'

const row = (over: Record<string, unknown> = {}) => ({
  organization_id: 'org-1', user_id: 'u1', source: 'boundary', message: 'boom', stack: 'at A', path: '/admin',
  app_version: 'abc1234', created_at: '2026-11-02T10:00:00Z', ...over
})

describe('groupErrors', () => {
  it('collapses repeats of the same error into one group with a count', () => {
    const groups = groupErrors([row(), row(), row()])
    expect(groups).toHaveLength(1)
    expect(groups[0].count).toBe(3)
  })

  it('counts distinct users and schools, not reports', () => {
    const groups = groupErrors([
      row({ user_id: 'u1' }), row({ user_id: 'u1' }), row({ user_id: 'u2' }), row({ user_id: 'u3', organization_id: 'org-2' })
    ])
    expect(groups[0]).toMatchObject({ count: 4, users: 3, organizations: 2 })
  })

  it('keeps different messages, and the same message from a different source, apart', () => {
    const groups = groupErrors([row(), row({ message: 'other' }), row({ source: 'window' })])
    expect(groups).toHaveLength(3)
  })

  it('puts the most frequent problem first, then the most recent', () => {
    const groups = groupErrors([
      row({ message: 'rare', created_at: '2026-11-02T12:00:00Z' }),
      row({ message: 'common' }), row({ message: 'common' }),
      row({ message: 'also rare', created_at: '2026-11-02T09:00:00Z' })
    ])
    expect(groups.map((g: { message: string }) => g.message)).toEqual(['common', 'rare', 'also rare'])
  })

  it('records first and last seen, the most common pages, and every code version involved', () => {
    const groups = groupErrors([
      row({ created_at: '2026-11-02T08:00:00Z', path: '/a', app_version: 'v1' }),
      row({ created_at: '2026-11-02T12:00:00Z', path: '/b', app_version: 'v2' }),
      row({ created_at: '2026-11-02T10:00:00Z', path: '/b', app_version: 'v2' }),
      row({ created_at: '2026-11-02T11:00:00Z', path: '/c', app_version: 'v1' })
    ])
    expect(groups[0]).toMatchObject({
      first_seen: '2026-11-02T08:00:00Z', last_seen: '2026-11-02T12:00:00Z', versions: ['v1', 'v2']
    })
    expect(groups[0].topPaths[0]).toBe('/b')
    expect(groups[0].topPaths).toHaveLength(3)
  })

  it('shows the stack from the most recent report', () => {
    const groups = groupErrors([
      row({ stack: 'old stack', created_at: '2026-11-02T08:00:00Z' }),
      row({ stack: 'new stack', created_at: '2026-11-02T12:00:00Z' })
    ])
    expect(groups[0].stack).toBe('new stack')
  })

  it('copes with reports that have no user (their account was deleted), path, version or stack', () => {
    const groups = groupErrors([row({ user_id: null, path: null, app_version: null, stack: null })])
    expect(groups[0]).toMatchObject({ users: 0, topPaths: [], versions: [], stack: null })
  })

  it('returns nothing for no reports', () => {
    expect(groupErrors([])).toEqual([])
  })
})

describe('formatReport', () => {
  it('says so plainly when there is nothing to report', () => {
    expect(formatReport([], { hours: 24, total: 0 })).toBe('No errors reported in the last 24 hours.\n')
  })

  it('lists each problem with its count, who it affected, where, and the top of its stack', () => {
    const groups = groupErrors([
      row({ stack: 'Error: boom\n at a\n at b\n at c\n at d\n at e' }), row({ user_id: 'u2', organization_id: 'org-2' })
    ])
    const text = formatReport(groups, { hours: 24, total: 2 })
    expect(text).toContain('2 error reports in the last 24 hours, 1 distinct')
    expect(text).toContain('1. [boundary] boom')
    expect(text).toContain('2x · 2 users · 2 schools')
    expect(text).toContain('version abc1234')
    expect(text).toContain('on /admin')
    expect(text).toContain('| Error: boom')
    expect(text).not.toContain('at e') // only the first few stack lines
  })

  it('uses the singular for a single report', () => {
    const text = formatReport(groupErrors([row()]), { hours: 1, total: 1 })
    expect(text).toContain('1 error report in the last 1 hours, 1 distinct')
    expect(text).toContain('1x · 1 user · 1 school')
  })
})
