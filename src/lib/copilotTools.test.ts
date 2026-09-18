import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  listUnassignedSections, findQualifiedInstructors, getInstructorWorkload,
  listSectionsTool, listAssignmentsTool, buildAssignmentPreview, buildDraftPreview
} from './copilotTools'
import { supabase } from './supabase'

vi.mock('./supabase', () => ({
  supabase: { from: vi.fn() }
}))

function chainable(data: unknown) {
  const chain: PromiseLike<{ data: unknown; error: null }> & Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    neq: () => chain,
    is: () => chain,
    order: () => chain,
    then: (resolve: (v: { data: unknown; error: null }) => unknown) => Promise.resolve({ data, error: null }).then(resolve)
  } as never
  return chain
}

const SECTIONS = [
  { id: 'sec-1', section_number: '01', hours_required: 3, status: 'unassigned', day_of_week: 'Monday', time_slot: '9:00 AM', course_id: 'course-1', course: { code: 'COMP2205', name: 'Data Structures' }, term: { name: 'Winter 2026' } },
  { id: 'sec-2', section_number: '02', hours_required: 3, status: 'filled', day_of_week: 'Tuesday', time_slot: '10:00 AM', course_id: 'course-1', course: { code: 'COMP2205', name: 'Data Structures' }, term: { name: 'Winter 2026' } },
  { id: 'sec-3', section_number: '01', hours_required: 3, status: 'unassigned', day_of_week: null, time_slot: null, course_id: 'course-2', course: { code: 'MATH1010', name: 'Calculus' }, term: { name: 'Winter 2026' } },
  { id: 'sec-4', section_number: '01', hours_required: 3, status: 'unassigned', day_of_week: 'Monday', time_slot: '2:00 PM', course_id: 'course-1', course: { code: 'COMP2205', name: 'Data Structures' }, term: { name: 'Fall 2025' } }
]

const INSTRUCTORS = [
  { id: 'inst-1', full_name: 'Jane Doe', instructor_profiles: { max_hours_per_term: 40 } },
  { id: 'inst-2', full_name: 'Bob Roe', instructor_profiles: { max_hours_per_term: 40 } }
]

const QUALIFICATIONS = [
  { instructor_id: 'inst-1', course_id: 'course-1' },
  { instructor_id: 'inst-2', course_id: 'course-1' }
  // course-2 (MATH1010) has no qualified instructor.
]

const TERMS = [
  { id: 'term-1', name: 'Winter 2026' },
  { id: 'term-2', name: 'Fall 2025' }
]

function mockTables(overrides: Partial<{
  sections: unknown[]; profiles: unknown[]; assignments: unknown[]
  qualifications: unknown[]; instructor_availability: unknown[]; terms: unknown[]
}> = {}) {
  const tables: Record<string, unknown[]> = {
    sections: overrides.sections ?? SECTIONS,
    profiles: overrides.profiles ?? INSTRUCTORS,
    assignments: overrides.assignments ?? [],
    qualifications: overrides.qualifications ?? QUALIFICATIONS,
    instructor_availability: overrides.instructor_availability ?? [],
    terms: overrides.terms ?? TERMS
  }
  vi.mocked(supabase.from).mockImplementation(((table: string) => chainable(tables[table] ?? [])) as never)
}

describe('listUnassignedSections', () => {
  beforeEach(() => vi.mocked(supabase.from).mockReset())

  it('flags a section with no qualified instructor at all', async () => {
    mockTables()
    const result = await listUnassignedSections()
    const math = result.sections.find(s => s.course_code === 'MATH1010')!
    expect(math.reason).toContain('No verified instructor is qualified to teach MATH1010')
  })

  it('reports an available qualified instructor when one exists', async () => {
    mockTables()
    const result = await listUnassignedSections()
    const comp = result.sections.find(s => s.id === 'sec-1')!
    expect(comp.reason).toMatch(/qualified instructor.*available right now/)
  })

  it('explains why every qualified instructor is blocked when none are available', async () => {
    mockTables({
      instructor_availability: [
        { instructor_id: 'inst-1', day: 'Monday', time_slot: '9:00 AM' },
        { instructor_id: 'inst-2', day: 'Monday', time_slot: '9:00 AM' }
      ]
    })
    const result = await listUnassignedSections()
    const comp = result.sections.find(s => s.id === 'sec-1')!
    expect(comp.reason).toContain('none are currently available')
    expect(comp.reason).toContain('Jane Doe')
    expect(comp.reason).toContain('Bob Roe')
  })

  it('only includes unassigned sections, not filled ones', async () => {
    mockTables()
    const result = await listUnassignedSections()
    expect(result.sections.some(s => s.id === 'sec-2')).toBe(false)
    expect(result.count).toBe(result.sections.length)
  })
})

describe('findQualifiedInstructors', () => {
  beforeEach(() => vi.mocked(supabase.from).mockReset())

  it('errors when the course code does not exist', async () => {
    mockTables()
    const result = await findQualifiedInstructors({ course_code: 'NOPE9999' })
    expect(result).toEqual({ error: 'No sections found for course code "NOPE9999".' })
  })

  it('errors and lists existing sections when day/time filters match nothing', async () => {
    mockTables()
    const result = await findQualifiedInstructors({ course_code: 'COMP2205', day_of_week: 'Friday' })
    expect('error' in result && result.error).toContain('No COMP2205 section matches that day/time')
    expect('error' in result && result.error).toContain('Section 01')
  })

  it('filters by time_period', async () => {
    mockTables()
    const result = await findQualifiedInstructors({ course_code: 'COMP2205', time_period: 'afternoon' })
    expect('matched_section' in result && result.matched_section!.id).toBe('sec-4')
  })

  it('returns available instructors sorted by hours remaining, and separates unavailable ones', async () => {
    mockTables({
      assignments: [
        { instructor_id: 'inst-1', hours_assigned: 30, section_id: 'other', section: { id: 'other', section_number: '99', hours_required: 3, day_of_week: 'Wednesday', time_slot: '9:00 AM', course: { code: 'X' } } }
      ],
      instructor_availability: [{ instructor_id: 'inst-2', day: 'Monday', time_slot: '9:00 AM' }]
    })
    const result = await findQualifiedInstructors({ course_code: 'COMP2205' })
    expect('available_instructors' in result).toBe(true)
    if ('available_instructors' in result) {
      expect(result.available_instructors!.map(i => i.name)).toEqual(['Jane Doe'])
      expect(result.unavailable_instructors!.map(i => i.name)).toEqual(['Bob Roe'])
    }
  })

  it('returns an error alongside the matched section when nobody is qualified', async () => {
    mockTables()
    const result = await findQualifiedInstructors({ course_code: 'MATH1010' })
    expect('matched_section' in result && result.matched_section!.course_code).toBe('MATH1010')
    expect('error' in result && result.error).toContain('No verified instructor is qualified to teach MATH1010')
  })
})

describe('getInstructorWorkload', () => {
  beforeEach(() => vi.mocked(supabase.from).mockReset())

  it('returns every instructor when no name filter is given', async () => {
    mockTables()
    const result = await getInstructorWorkload({})
    expect(result).toEqual({
      instructors: [
        { name: 'Jane Doe', hours_assigned: 0, max_hours: 40, hours_remaining: 40 },
        { name: 'Bob Roe', hours_assigned: 0, max_hours: 40, hours_remaining: 40 }
      ]
    })
  })

  it('filters by a case-insensitive partial name match', async () => {
    mockTables()
    const result = await getInstructorWorkload({ instructor_name: 'jane' })
    expect('instructors' in result && result.instructors).toHaveLength(1)
    expect('instructors' in result && result.instructors![0].name).toBe('Jane Doe')
  })

  it('errors when the name matches nobody', async () => {
    mockTables()
    const result = await getInstructorWorkload({ instructor_name: 'Nobody' })
    expect(result).toEqual({ error: 'No instructor found matching "Nobody".' })
  })
})

describe('listSectionsTool', () => {
  beforeEach(() => vi.mocked(supabase.from).mockReset())

  it('filters by status', async () => {
    mockTables()
    const result = await listSectionsTool({ status: 'filled' })
    expect(result.count).toBe(1)
    expect(result.sections[0].id).toBe('sec-2')
  })

  it('filters by a partial, case-insensitive term name', async () => {
    mockTables()
    const result = await listSectionsTool({ term_name: 'fall' })
    expect(result.sections.map(s => s.id)).toEqual(['sec-4'])
  })

  it('returns everything when status is "all" and no term filter is given', async () => {
    mockTables()
    const result = await listSectionsTool({ status: 'all' })
    expect(result.count).toBe(SECTIONS.length)
  })
})

describe('listAssignmentsTool', () => {
  it('maps live assignments into a flat summary', async () => {
    mockTables({
      assignments: [{
        instructor_id: 'inst-1', hours_assigned: 3, section_id: 'sec-1',
        instructor: { id: 'inst-1', full_name: 'Jane Doe' },
        section: { id: 'sec-1', section_number: '01', hours_required: 3, day_of_week: 'Monday', time_slot: '9:00 AM', course: { code: 'COMP2205' } }
      }]
    })
    const result = await listAssignmentsTool()
    expect(result).toEqual({
      count: 1,
      assignments: [{ instructor: 'Jane Doe', course_code: 'COMP2205', section_number: '01', day_time: 'Monday 9:00 AM', hours: 3 }]
    })
  })
})

describe('buildAssignmentPreview', () => {
  beforeEach(() => vi.mocked(supabase.from).mockReset())

  it('errors on an unknown section id', async () => {
    mockTables()
    const result = await buildAssignmentPreview({ section_id: 'bogus', instructor_id: 'inst-1' })
    expect('error' in result && result.error).toContain('No section found with id bogus')
  })

  it('errors on an unknown instructor id', async () => {
    mockTables()
    const result = await buildAssignmentPreview({ section_id: 'sec-1', instructor_id: 'bogus' })
    expect('error' in result && result.error).toContain('No instructor found with id bogus')
  })

  it('blocks when the section already has a live assignment', async () => {
    mockTables({
      assignments: [{
        instructor_id: 'inst-2', hours_assigned: 3, section_id: 'sec-1',
        instructor: { id: 'inst-2', full_name: 'Bob Roe' },
        section: { id: 'sec-1', section_number: '01', hours_required: 3, day_of_week: 'Monday', time_slot: '9:00 AM', course: { code: 'COMP2205' } }
      }]
    })
    const result = await buildAssignmentPreview({ section_id: 'sec-1', instructor_id: 'inst-1' })
    expect('blocked' in result && result.blocked).toBe(true)
    expect('reasons' in result && result.reasons[0]).toContain('already has an instructor assigned (Bob Roe)')
  })

  it('blocks on a scheduling conflict from checkAssignmentConflicts', async () => {
    mockTables({ instructor_availability: [{ instructor_id: 'inst-1', day: 'Monday', time_slot: '9:00 AM' }] })
    const result = await buildAssignmentPreview({ section_id: 'sec-1', instructor_id: 'inst-1' })
    expect('blocked' in result && result.blocked).toBe(true)
    expect('reasons' in result && result.reasons.join(' ')).toContain('unavailable')
  })

  it('returns a clean, unblocked preview when nothing conflicts', async () => {
    mockTables()
    const result = await buildAssignmentPreview({ section_id: 'sec-1', instructor_id: 'inst-1' })
    expect(result).toEqual({
      kind: 'assignment',
      sectionId: 'sec-1',
      instructorId: 'inst-1',
      sectionLabel: 'COMP2205 — Section 01',
      instructorName: 'Jane Doe',
      hours: 3,
      dayTime: 'Monday 9:00 AM',
      blocked: false,
      reasons: []
    })
  })
})

describe('buildDraftPreview', () => {
  beforeEach(() => vi.mocked(supabase.from).mockReset())

  it('errors when no term matches, listing the available ones', async () => {
    mockTables()
    const result = await buildDraftPreview({ name: 'My Draft', term_name: 'Summer 2099' })
    expect('error' in result && result.error).toContain('No term found matching "Summer 2099"')
    expect('error' in result && result.error).toContain('Winter 2026')
  })

  it('matches a term by partial, case-insensitive name', async () => {
    mockTables()
    const result = await buildDraftPreview({ name: 'My Draft', term_name: 'winter' })
    expect('termId' in result && result.termId).toBe('term-1')
  })

  it('blocks when the draft name is too short', async () => {
    mockTables()
    const result = await buildDraftPreview({ name: 'A', term_name: 'Winter 2026' })
    expect('blocked' in result && result.blocked).toBe(true)
    expect('reasons' in result && result.reasons[0]).toContain('at least 2 characters')
  })

  it('returns a clean preview for a valid name and term', async () => {
    mockTables()
    const result = await buildDraftPreview({ name: 'AI Draft', term_name: 'Winter 2026' })
    expect(result).toEqual({
      kind: 'draft',
      name: 'AI Draft',
      termId: 'term-1',
      termName: 'Winter 2026',
      blocked: false,
      reasons: []
    })
  })
})
