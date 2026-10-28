import { describe, it, expect } from 'vitest'
import { titleForPath, formatTitle, ROUTE_TITLES } from './pageTitles'

describe('titleForPath', () => {
  it('names each page', () => {
    expect(titleForPath('/admin')).toBe('Dashboard')
    expect(titleForPath('/admin/team')).toBe('Team and access')
    expect(titleForPath('/instructor/availability')).toBe('Availability')
    expect(titleForPath('/coordinator/analytics')).toBe('Analytics')
  })

  it('ignores a trailing slash', () => {
    expect(titleForPath('/admin/courses/')).toBe('Courses')
  })

  it('names a single draft, whatever its id', () => {
    expect(titleForPath('/admin/drafts/3f2b8c1e-9d4a-4e6b-8a1c-7d2e5f9a0b3c')).toBe('Draft')
  })

  it('has no title for unknown paths', () => {
    expect(titleForPath('/nowhere')).toBeNull()
    expect(titleForPath('/admin/drafts/a/b')).toBeNull()
  })

  it('gives every page its own title within a role, so that history and tabs are distinguishable', () => {
    for (const prefix of ['/admin', '/instructor', '/coordinator']) {
      const titles = Object.entries(ROUTE_TITLES).filter(([p]) => p === prefix || p.startsWith(prefix + '/')).map(([, t]) => t)
      expect(new Set(titles).size, prefix).toBe(titles.length)
    }
  })
})

describe('formatTitle', () => {
  it('puts the page first and the product last', () => {
    expect(formatTitle('Courses')).toBe('Courses — CourseSync')
  })
  it('falls back to the product name', () => {
    expect(formatTitle(null)).toBe('CourseSync')
  })
})
