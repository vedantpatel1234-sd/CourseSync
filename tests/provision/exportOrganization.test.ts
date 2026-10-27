// @vitest-environment node
import { describe, it, expect } from 'vitest'
// @ts-expect-error - plain ES module script, no type declarations
import { toCsv, fetchAllRows, buildScheduleRows, exportOrganization, EXPORT_TABLES } from '../../scripts/exportOrganization.mjs'
import { fakeSupabase } from './fakeSupabase'

const ORG = { id: 'org-1', name: 'Fraser Valley College', slug: 'fraser-valley' }
const BOM = '﻿'

describe('toCsv', () => {
  it('writes a header and one line per row, with a byte-order mark for Excel', () => {
    const csv = toCsv([{ a: 1, b: 'x' }, { a: 2, b: 'y' }])
    expect(csv).toBe(`${BOM}a,b\r\n1,x\r\n2,y\r\n`)
  })

  it('quotes fields containing commas, quotes or line breaks, doubling inner quotes', () => {
    const csv = toCsv([{ name: 'Smith, Jane', note: 'said "hi"', text: 'line1\nline2' }])
    expect(csv).toBe(`${BOM}name,note,text\r\n"Smith, Jane","said ""hi""","line1\nline2"\r\n`)
  })

  it('writes empty cells for null and undefined, JSON for objects, plain text for booleans', () => {
    const csv = toCsv([{ a: null, b: undefined, c: { k: 'v' }, d: true, e: [1, 2] }], ['a', 'b', 'c', 'd', 'e'])
    expect(csv).toBe(`${BOM}a,b,c,d,e\r\n,,"{""k"":""v""}",true,"[1,2]"\r\n`)
  })

  it('neutralises text that a spreadsheet would run as a formula, but not numbers', () => {
    const csv = toCsv([{ a: '=SUM(A1:A9)', b: '+cmd', c: '-1', d: '@x', e: -5, f: 'safe' }])
    expect(csv).toContain(`'=SUM(A1:A9),'+cmd,'-1,'@x,-5,safe`)
  })

  it('keeps accented and non-Latin text intact', () => {
    expect(toCsv([{ name: 'Zoë Müller 李' }])).toContain('Zoë Müller 李')
  })

  it('writes just the header when given columns and no rows', () => {
    expect(toCsv([], ['x', 'y'])).toBe(`${BOM}x,y\r\n`)
  })
})

describe('fetchAllRows', () => {
  const rowsOf = (n: number, org = 'org-1') => Array.from({ length: n }, (_, i) => ({ id: String(i).padStart(4, '0'), organization_id: org }))

  it('returns only the organization\'s rows, across several pages', async () => {
    const { client, log } = fakeSupabase({ courses: [...rowsOf(7), ...rowsOf(3, 'org-2')] })
    const rows = await fetchAllRows(client, 'courses', 'org-1', 3)
    expect(rows).toHaveLength(7)
    expect(rows.every((r: { organization_id: string }) => r.organization_id === 'org-1')).toBe(true)
    expect(log.reads.filter(r => r.startsWith('courses ['))).toEqual(['courses [0-2]', 'courses [3-5]', 'courses [6-8]'])
  })

  it('stops correctly when the row count is an exact multiple of the page size', async () => {
    const { client } = fakeSupabase({ courses: rowsOf(6) })
    expect(await fetchAllRows(client, 'courses', 'org-1', 3)).toHaveLength(6)
  })

  it('returns an empty list for an empty table', async () => {
    const { client } = fakeSupabase({ courses: [] })
    expect(await fetchAllRows(client, 'courses', 'org-1', 3)).toEqual([])
  })

  it('refuses to produce an export that is short of what the database holds', async () => {
    const { client } = fakeSupabase({ courses: rowsOf(7) }, { dropRows: { courses: 1 } })
    await expect(fetchAllRows(client, 'courses', 'org-1', 3)).rejects.toThrow(/incomplete: read \d+ rows but the database has 7/)
  })
})

describe('buildScheduleRows', () => {
  const data = {
    courses: [{ id: 'c1', code: 'CS101', name: 'Intro' }],
    terms: [{ id: 't1', name: 'Fall 2026' }],
    sections: [{ id: 's1', course_id: 'c1', term_id: 't1', section_number: '001', day_of_week: 'Monday', time_slot: '9:00 AM' }],
    profiles: [{ id: 'u1', full_name: 'Jane Doe', email: 'jane@x.test' }],
    instructorProfiles: [{ user_id: 'u1', department: 'Computer Science', title: 'Professor' }],
    assignments: [
      { id: 'a1', section_id: 's1', instructor_id: 'u1', hours_assigned: 3, status: 'active', draft_id: null },
      { id: 'a2', section_id: 's1', instructor_id: 'u1', hours_assigned: 3, status: 'active', draft_id: 'd1' },
      { id: 'a3', section_id: 's1', instructor_id: 'u1', hours_assigned: 3, status: 'rejected', draft_id: null }
    ]
  }

  it('lists live assignments with names instead of ids', () => {
    expect(buildScheduleRows(data)).toEqual([{
      term: 'Fall 2026', course_code: 'CS101', course_name: 'Intro', section: '001', day: 'Monday', time: '9:00 AM',
      hours_assigned: 3, instructor_name: 'Jane Doe', instructor_email: 'jane@x.test',
      department: 'Computer Science', title: 'Professor'
    }])
  })

  it('leaves out draft and rejected assignments', () => {
    expect(buildScheduleRows(data)).toHaveLength(1)
  })

  it('tolerates a missing instructor or section instead of failing', () => {
    const rows = buildScheduleRows({ ...data, profiles: [], assignments: [data.assignments[0]] })
    expect(rows[0]).toMatchObject({ instructor_name: '', instructor_email: '', course_code: 'CS101' })
  })

  it('sorts by term, then course, then section', () => {
    const more = {
      ...data,
      courses: [...data.courses, { id: 'c2', code: 'AA100', name: 'Other' }],
      sections: [...data.sections, { id: 's2', course_id: 'c2', term_id: 't1', section_number: '002', day_of_week: null, time_slot: null }],
      assignments: [...data.assignments.slice(0, 1), { id: 'a4', section_id: 's2', instructor_id: 'u1', hours_assigned: 3, status: 'active', draft_id: null }]
    }
    expect(buildScheduleRows(more).map(r => r.course_code)).toEqual(['AA100', 'CS101'])
  })
})

describe('exportOrganization', () => {
  const tables = () => ({
    profiles: [{ id: 'u1', organization_id: 'org-1', full_name: 'Jane Doe', email: 'jane@x.test', role: 'instructor' }],
    instructor_profiles: [{ id: 'ip1', organization_id: 'org-1', user_id: 'u1', department: 'CS', title: 'Prof' }],
    courses: [{ id: 'c1', organization_id: 'org-1', code: 'CS101', name: 'Intro' }, { id: 'c9', organization_id: 'org-2', code: 'XX', name: 'Other school' }],
    terms: [{ id: 't1', organization_id: 'org-1', name: 'Fall' }],
    sections: [{ id: 's1', organization_id: 'org-1', course_id: 'c1', term_id: 't1', section_number: '001', day_of_week: 'Monday', time_slot: '9:00 AM' }],
    assignments: [{ id: 'a1', organization_id: 'org-1', section_id: 's1', instructor_id: 'u1', hours_assigned: 3, status: 'active', draft_id: null }],
    organization_billing: [{ organization_id: 'org-1', plan: 'standard', subscription_status: 'active', stripe_customer_id: 'cus_secret' }]
  })

  it('produces a file per non-empty table, a readable schedule, and the supporting documents', async () => {
    const { client } = fakeSupabase(tables())
    const { files } = await exportOrganization(client, ORG, { now: new Date('2027-03-01T10:00:00Z') })

    expect([...files.keys()].sort()).toEqual([
      'README.txt', 'assignments.csv', 'courses.csv', 'instructor_profiles.csv', 'manifest.json',
      'organization.json', 'profiles.csv', 'schedule.csv', 'sections.csv', 'terms.csv'
    ])
  })

  it('exports only this organization\'s rows', async () => {
    const { client } = fakeSupabase(tables())
    const { files } = await exportOrganization(client, ORG)
    expect(files.get('courses.csv')).toContain('CS101')
    expect(files.get('courses.csv')).not.toContain('Other school')
  })

  it('records exactly what was exported, for later checks', async () => {
    const { client } = fakeSupabase(tables())
    const { manifest, files } = await exportOrganization(client, ORG, { now: new Date('2027-03-01T10:00:00Z') })

    expect(manifest).toMatchObject({ exported_at: '2027-03-01T10:00:00.000Z', organization_id: 'org-1', organization_slug: 'fraser-valley' })
    expect(manifest.counts.courses).toBe(1)
    expect(manifest.counts.notifications).toBe(0)
    expect(Object.keys(manifest.counts).sort()).toEqual([...EXPORT_TABLES].sort())
    expect(JSON.parse(files.get('manifest.json')!)).toEqual(manifest)
  })

  it('includes the plan but never Stripe identifiers', async () => {
    const { client } = fakeSupabase(tables())
    const { files } = await exportOrganization(client, ORG)
    const org = JSON.parse(files.get('organization.json')!)
    expect(org.name).toBe('Fraser Valley College')
    expect(files.get('organization.json')).not.toContain('cus_secret')
  })

  it('puts the readable schedule in schedule.csv', async () => {
    const { client } = fakeSupabase(tables())
    const { files } = await exportOrganization(client, ORG)
    expect(files.get('schedule.csv')).toContain('Fall,CS101,Intro,001,Monday,9:00 AM,3,Jane Doe,jane@x.test,CS,Prof')
  })

  it('fails rather than hand over an incomplete export', async () => {
    const { client } = fakeSupabase(tables(), { dropRows: { courses: 1 } })
    await expect(exportOrganization(client, ORG, { pageSize: 1 })).rejects.toThrow(/incomplete/)
  })
})
