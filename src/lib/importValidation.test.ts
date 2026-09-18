import { describe, it, expect, vi, beforeEach } from 'vitest'
import { validateCourseRows, validateInstructorRows } from './importValidation'
import { supabase } from './supabase'

vi.mock('./supabase', () => ({
  supabase: { from: vi.fn() }
}))

// Builds a chainable query stub: every method (select/eq) returns itself, and
// awaiting the chain at any point resolves to { data, error: null } — mirrors
// how supabase-js's PostgrestFilterBuilder is both chainable and thenable.
function chainable(data: unknown) {
  const chain: PromiseLike<{ data: unknown; error: null }> & Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    then: (resolve: (v: { data: unknown; error: null }) => unknown) => Promise.resolve({ data, error: null }).then(resolve)
  } as never
  return chain
}

describe('validateCourseRows', () => {
  beforeEach(() => {
    vi.mocked(supabase.from).mockReset()
  })

  it('passes clean, unique, new rows with no issues', async () => {
    vi.mocked(supabase.from).mockReturnValue(chainable([]) as never)
    const issues = await validateCourseRows([{ code: 'CS101', name: 'Intro to CS' }])
    expect(issues).toEqual([])
  })

  it('flags a missing code and a missing name separately', async () => {
    vi.mocked(supabase.from).mockReturnValue(chainable([]) as never)
    const issues = await validateCourseRows([
      { code: '', name: 'No Code' },
      { code: 'CS102', name: '' }
    ])
    expect(issues).toEqual([
      { rowIndex: 0, message: 'Missing course code' },
      { rowIndex: 1, message: 'Missing course name' }
    ])
  })

  it('flags a duplicate code within the same file, case-insensitively', async () => {
    vi.mocked(supabase.from).mockReturnValue(chainable([]) as never)
    const issues = await validateCourseRows([
      { code: 'CS101', name: 'Intro' },
      { code: 'cs101', name: 'Intro Again' }
    ])
    expect(issues).toEqual([{ rowIndex: 1, message: 'Duplicate code "cs101" within this file' }])
  })

  it('flags a code that already exists in the database', async () => {
    vi.mocked(supabase.from).mockReturnValue(chainable([{ code: 'CS101' }]) as never)
    const issues = await validateCourseRows([{ code: 'CS101', name: 'Intro' }])
    expect(issues).toEqual([{ rowIndex: 0, message: 'Course code "CS101" already exists' }])
  })
})

describe('validateInstructorRows', () => {
  beforeEach(() => {
    vi.mocked(supabase.from).mockReset()
  })

  it('passes a clean new instructor row', async () => {
    vi.mocked(supabase.from).mockReturnValue(chainable([]) as never)
    const issues = await validateInstructorRows([{ full_name: 'Jane Doe', email: 'jane@example.com' }])
    expect(issues).toEqual([])
  })

  it('flags an invalid email format', async () => {
    vi.mocked(supabase.from).mockReturnValue(chainable([]) as never)
    const issues = await validateInstructorRows([{ full_name: 'Jane Doe', email: 'not-an-email' }])
    expect(issues).toEqual([{ rowIndex: 0, message: '"not-an-email" doesn\'t look like a valid email' }])
  })

  it('flags a duplicate email within the file, case-insensitively', async () => {
    vi.mocked(supabase.from).mockReturnValue(chainable([]) as never)
    const issues = await validateInstructorRows([
      { full_name: 'Jane Doe', email: 'jane@example.com' },
      { full_name: 'Jane D.', email: 'JANE@example.com' }
    ])
    expect(issues).toEqual([{ rowIndex: 1, message: 'Duplicate email "JANE@example.com" within this file' }])
  })

  it('flags an email that already belongs to an existing instructor', async () => {
    vi.mocked(supabase.from).mockReturnValue(chainable([{ email: 'jane@example.com' }]) as never)
    const issues = await validateInstructorRows([{ full_name: 'Jane Doe', email: 'jane@example.com' }])
    expect(issues).toEqual([{ rowIndex: 0, message: 'An instructor with email "jane@example.com" already exists' }])
  })

  it('flags a non-numeric or non-positive max_hours', async () => {
    vi.mocked(supabase.from).mockReturnValue(chainable([]) as never)
    const issues = await validateInstructorRows([
      { full_name: 'Jane Doe', email: 'jane@example.com', max_hours: 'abc' },
      { full_name: 'Bob Roe', email: 'bob@example.com', max_hours: '0' }
    ])
    expect(issues).toEqual([
      { rowIndex: 0, message: '"abc" isn\'t a valid number of hours' },
      { rowIndex: 1, message: '"0" isn\'t a valid number of hours' }
    ])
  })

  it('accepts a blank max_hours', async () => {
    vi.mocked(supabase.from).mockReturnValue(chainable([]) as never)
    const issues = await validateInstructorRows([{ full_name: 'Jane Doe', email: 'jane@example.com', max_hours: '' }])
    expect(issues).toEqual([])
  })
})
