import { describe, it, expect, vi, beforeEach } from 'vitest'
import { runAutoScheduler } from './autoScheduler'
import { supabase } from './supabase'
import { createMessage } from './anthropic'

vi.mock('./supabase', () => ({
  supabase: { from: vi.fn() }
}))

vi.mock('./anthropic', () => ({
  createMessage: vi.fn(),
  COPILOT_MODEL: 'claude-opus-5'
}))

// Chainable query stub shared by every table: any select/eq/order/is/neq call
// returns itself, and awaiting the chain resolves to { data, error: null } —
// mirrors supabase-js's PostgrestFilterBuilder being both chainable and thenable.
function chainable(data: unknown) {
  const chain: PromiseLike<{ data: unknown; error: null }> & Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    is: () => chain,
    neq: () => chain,
    then: (resolve: (v: { data: unknown; error: null }) => unknown) => Promise.resolve({ data, error: null }).then(resolve)
  } as never
  return chain
}

const SECTIONS = [
  { id: 'sec-A', section_number: '01', hours_required: 3, status: 'unassigned', day_of_week: 'Monday', time_slot: '9:00 AM', course_id: 'course-1', course: { code: 'CS101', name: 'Intro' } },
  { id: 'sec-B', section_number: '02', hours_required: 3, status: 'unassigned', day_of_week: 'Monday', time_slot: '10:00 AM', course_id: 'course-2', course: { code: 'CS102', name: 'Data Structures' } },
  { id: 'sec-C', section_number: '03', hours_required: 3, status: 'unassigned', day_of_week: null, time_slot: null, course_id: 'course-3', course: { code: 'CS103', name: 'Algorithms' } },
  { id: 'sec-D', section_number: '04', hours_required: 3, status: 'unassigned', day_of_week: 'Tuesday', time_slot: '9:00 AM', course_id: 'course-4', course: { code: 'CS104', name: 'Databases' } }
]

const INSTRUCTORS = [
  { id: 'inst-1', full_name: 'Jane Doe', instructor_profiles: { max_hours_per_term: 40 } },
  { id: 'inst-2', full_name: 'Bob Roe', instructor_profiles: { max_hours_per_term: 40 } }
]

const LIVE_ASSIGNMENTS = [
  {
    instructor_id: 'inst-2', hours_assigned: 3, section_id: 'sec-existing',
    section: { id: 'sec-existing', section_number: '99', hours_required: 3, day_of_week: 'Monday', time_slot: '9:00 AM', course: { code: 'CS999' } }
  }
]

function mockTables(overrides: Partial<{ sections: unknown[]; profiles: unknown[]; assignments: unknown[]; instructor_availability: unknown[]; qualifications: unknown[]; preferences: unknown[] }> = {}) {
  const tables: Record<string, unknown[]> = {
    sections: overrides.sections ?? SECTIONS,
    profiles: overrides.profiles ?? INSTRUCTORS,
    assignments: overrides.assignments ?? LIVE_ASSIGNMENTS,
    instructor_availability: overrides.instructor_availability ?? [],
    qualifications: overrides.qualifications ?? [],
    preferences: overrides.preferences ?? []
  }
  vi.mocked(supabase.from).mockImplementation(((table: string) => chainable(tables[table] ?? [])) as never)
}

function mockAiResponse(assignments: { section_id: string; instructor_id: string; rationale: string }[], unassignable: { section_id: string; reason: string }[] = []) {
  vi.mocked(createMessage).mockResolvedValue({
    content: [{
      type: 'tool_use',
      id: 'tool_1',
      name: 'submit_schedule_plan',
      input: { assignments, unassignable }
    }]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any)
}

describe('runAutoScheduler', () => {
  beforeEach(() => {
    vi.mocked(supabase.from).mockReset()
    vi.mocked(createMessage).mockReset()
  })

  it('returns early with noSectionsFound when the term has nothing unassigned', async () => {
    mockTables({ sections: [] })
    const result = await runAutoScheduler('term-1')
    expect(result).toEqual({ accepted: [], rejected: [], noSectionsFound: true })
    expect(createMessage).not.toHaveBeenCalled()
  })

  it('re-validates every AI proposal instead of trusting it', async () => {
    mockTables()
    mockAiResponse([
      // Double-booked: inst-2 is already teaching sec-existing at Monday 9:00 AM live.
      { section_id: 'sec-A', instructor_id: 'inst-2', rationale: 'Bob is available' },
      // Valid, should be accepted.
      { section_id: 'sec-B', instructor_id: 'inst-1', rationale: 'Jane is qualified and available' },
      // Duplicate proposal for an already-handled section — must be silently ignored.
      { section_id: 'sec-B', instructor_id: 'inst-1', rationale: 'duplicate proposal' },
      // Invented instructor id that does not exist in the fetched data.
      { section_id: 'sec-D', instructor_id: 'inst-invented', rationale: 'made up' }
      // sec-C is never mentioned at all, in either list.
    ])

    const result = await runAutoScheduler('term-1')

    expect(result.noSectionsFound).toBe(false)
    expect(result.accepted).toEqual([
      {
        sectionId: 'sec-B',
        instructorId: 'inst-1',
        hours: 3,
        sectionLabel: 'CS102 — Section 02',
        instructorName: 'Jane Doe',
        dayTime: 'Monday 10:00 AM',
        rationale: 'Jane is qualified and available'
      }
    ])

    expect(result.rejected).toHaveLength(3)

    const bySection = Object.fromEntries(result.rejected.map(r => [r.sectionLabel, r.reason]))
    expect(bySection['CS101 — Section 01']).toContain('Blocked: Bob Roe is already teaching CS999 Section 99 on Monday 9:00 AM')
    expect(bySection['CS104 — Section 04']).toBe('AI proposed an instructor id that does not exist — skipped.')
    expect(bySection['CS103 — Section 03']).toBe('AI did not propose an assignment for this section.')
  })

  it('honors AI-declared unassignable reasons when given', async () => {
    mockTables()
    mockAiResponse(
      [{ section_id: 'sec-B', instructor_id: 'inst-1', rationale: 'Jane is qualified' }],
      [
        { section_id: 'sec-A', reason: 'No qualified instructor has capacity left.' },
        { section_id: 'sec-D', reason: 'No qualified instructor has capacity left.' }
      ]
    )

    const result = await runAutoScheduler('term-1')
    const bySection = Object.fromEntries(result.rejected.map(r => [r.sectionLabel, r.reason]))
    expect(bySection['CS101 — Section 01']).toBe('No qualified instructor has capacity left.')
    expect(bySection['CS104 — Section 04']).toBe('No qualified instructor has capacity left.')
    // sec-C still wasn't mentioned by the model anywhere, so it falls through to the generic reason.
    expect(bySection['CS103 — Section 03']).toBe('AI did not propose an assignment for this section.')
  })

  it('rejects a second proposal that would double-book an instructor against a proposal already accepted earlier in the same run', async () => {
    const customSections = [
      { id: 'sec-A', section_number: '01', hours_required: 3, status: 'unassigned', day_of_week: 'Monday', time_slot: '9:00 AM', course_id: 'course-1', course: { code: 'CS101', name: 'Intro' } },
      { id: 'sec-E', section_number: '05', hours_required: 3, status: 'unassigned', day_of_week: 'Monday', time_slot: '9:00 AM', course_id: 'course-5', course: { code: 'CS105', name: 'Networks' } }
    ]
    mockTables({ sections: customSections, assignments: [] })
    mockAiResponse([
      { section_id: 'sec-A', instructor_id: 'inst-1', rationale: 'Jane first pick' },
      { section_id: 'sec-E', instructor_id: 'inst-1', rationale: 'Jane again, same slot' }
    ])

    const result = await runAutoScheduler('term-1')
    // Both sections share a day/time slot and only the first proposal was live data —
    // the second is only catchable by re-checking against this run's own running list.
    expect(result.accepted.map(a => a.sectionId)).toEqual(['sec-A'])
    expect(result.rejected).toHaveLength(1)
    expect(result.rejected[0].reason).toContain('already teaching CS101 Section 01 on Monday 9:00 AM')
  })
})
