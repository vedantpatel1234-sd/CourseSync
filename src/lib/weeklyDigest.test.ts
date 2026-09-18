import { describe, it, expect, vi, beforeEach } from 'vitest'
import { generateWeeklyDigest } from './weeklyDigest'
import { supabase } from './supabase'
import { createMessage } from './anthropic'

vi.mock('./supabase', () => ({
  supabase: { from: vi.fn() }
}))

vi.mock('./anthropic', () => ({
  createMessage: vi.fn(),
  COPILOT_MODEL: 'claude-opus-5'
}))

function chainable(data: unknown) {
  const chain: PromiseLike<{ data: unknown; error: null }> & Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    neq: () => chain,
    is: () => chain,
    then: (resolve: (v: { data: unknown; error: null }) => unknown) => Promise.resolve({ data, error: null }).then(resolve)
  } as never
  return chain
}

function mockTables(overrides: Partial<{ sections: unknown[]; profiles: unknown[]; assignments: unknown[] }> = {}) {
  const tables: Record<string, unknown[]> = {
    sections: overrides.sections ?? [],
    profiles: overrides.profiles ?? [],
    assignments: overrides.assignments ?? []
  }
  vi.mocked(supabase.from).mockImplementation(((table: string) => chainable(tables[table] ?? [])) as never)
}

function mockAiResponse(summary: string, highlights: { severity: 'high' | 'medium' | 'low'; text: string }[]) {
  vi.mocked(createMessage).mockResolvedValue({
    content: [{
      type: 'tool_use',
      id: 'tool_1',
      name: 'submit_digest',
      input: { summary, highlights }
    }]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any)
}

describe('generateWeeklyDigest', () => {
  beforeEach(() => {
    vi.mocked(supabase.from).mockReset()
    vi.mocked(createMessage).mockReset()
  })

  it('computes days-until-start for a section whose term has a start date', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    mockTables({
      sections: [{ section_number: '01', status: 'unassigned', course: { code: 'CS101' }, term: { name: 'Winter 2026', start_date: '2026-01-11' } }]
    })
    mockAiResponse('All quiet.', [])

    const result = await generateWeeklyDigest()
    expect(result.stats.unfilledSections[0].daysUntilStart).toBe(10)
    vi.useRealTimers()
  })

  it('leaves daysUntilStart null when the term has no start date', async () => {
    mockTables({
      sections: [{ section_number: '01', status: 'unassigned', course: { code: 'CS101' }, term: { name: 'Winter 2026', start_date: null } }]
    })
    mockAiResponse('All quiet.', [])

    const result = await generateWeeklyDigest()
    expect(result.stats.unfilledSections[0].daysUntilStart).toBeNull()
  })

  it('classifies instructors at or above 90% load as overloaded', async () => {
    mockTables({
      profiles: [{ id: 'i1', full_name: 'Jane Doe', instructor_profiles: { max_hours_per_term: 40 } }],
      assignments: [{ instructor_id: 'i1', hours_assigned: 36 }]
    })
    mockAiResponse('All quiet.', [])

    const result = await generateWeeklyDigest()
    expect(result.stats.overloadedInstructors).toEqual([{ name: 'Jane Doe', hoursAssigned: 36, maxHours: 40, percent: 90 }])
    expect(result.stats.underutilizedInstructors).toEqual([])
  })

  it('classifies instructors at or below 25% load as underutilized', async () => {
    mockTables({
      profiles: [{ id: 'i1', full_name: 'Bob Roe', instructor_profiles: { max_hours_per_term: 40 } }],
      assignments: [{ instructor_id: 'i1', hours_assigned: 5 }]
    })
    mockAiResponse('All quiet.', [])

    const result = await generateWeeklyDigest()
    expect(result.stats.underutilizedInstructors).toEqual([{ name: 'Bob Roe', hoursAssigned: 5, maxHours: 40, percent: 13 }])
    expect(result.stats.overloadedInstructors).toEqual([])
  })

  it('leaves an instructor in neither bucket at a mid-range load', async () => {
    mockTables({
      profiles: [{ id: 'i1', full_name: 'Sam Lee', instructor_profiles: { max_hours_per_term: 40 } }],
      assignments: [{ instructor_id: 'i1', hours_assigned: 20 }]
    })
    mockAiResponse('All quiet.', [])

    const result = await generateWeeklyDigest()
    expect(result.stats.overloadedInstructors).toEqual([])
    expect(result.stats.underutilizedInstructors).toEqual([])
  })

  it('defaults an instructor with no profile row to a 40-hour cap', async () => {
    mockTables({
      profiles: [{ id: 'i1', full_name: 'No Profile', instructor_profiles: null }],
      assignments: [{ instructor_id: 'i1', hours_assigned: 36 }]
    })
    mockAiResponse('All quiet.', [])

    const result = await generateWeeklyDigest()
    expect(result.stats.overloadedInstructors[0].maxHours).toBe(40)
  })

  it('passes the summary and highlights straight through from the model', async () => {
    mockTables()
    mockAiResponse('Two sections need attention.', [{ severity: 'high', text: 'CS101 Section 01 is still unfilled and starts in 2 days.' }])

    const result = await generateWeeklyDigest()
    expect(result.summary).toBe('Two sections need attention.')
    expect(result.highlights).toEqual([{ severity: 'high', text: 'CS101 Section 01 is still unfilled and starts in 2 days.' }])
  })

  it('falls back to a default summary when the model returns no tool_use block', async () => {
    mockTables()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(createMessage).mockResolvedValue({ content: [] } as any)

    const result = await generateWeeklyDigest()
    expect(result.summary).toBe('No summary available.')
    expect(result.highlights).toEqual([])
  })

  it('sends the computed stats to the model as the message content', async () => {
    mockTables({
      sections: [{ section_number: '01', status: 'unassigned', course: { code: 'CS101' }, term: { name: 'Winter 2026', start_date: null } }]
    })
    mockAiResponse('All quiet.', [])

    await generateWeeklyDigest()
    const call = vi.mocked(createMessage).mock.calls[0][0]
    const sentContent = JSON.parse(call.messages[0].content as string)
    expect(sentContent.unfilledSections[0].courseCode).toBe('CS101')
  })
})
