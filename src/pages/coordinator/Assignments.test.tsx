import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import CoordinatorAssignments from './Assignments'
import { supabase } from '../../lib/supabase'

vi.mock('../../lib/supabase', () => ({ supabase: { from: vi.fn() } }))

function chainable(data: unknown) {
  const chain: PromiseLike<{ data: unknown; error: null }> & Record<string, unknown> = {
    select: () => chain,
    is: () => chain,
    neq: () => chain,
    then: (resolve: (v: { data: unknown; error: null }) => unknown) => Promise.resolve({ data, error: null }).then(resolve)
  } as never
  return chain
}

const ASSIGNMENTS = [{
  id: 'a1', hours_assigned: 3,
  instructor: { full_name: 'Jane Doe', email: 'jane@example.com' },
  section: { section_number: '01', status: 'filled', day_of_week: 'Monday', time_slot: '9:00 AM', course: { code: 'CS101', name: 'Intro to CS' }, term: { name: 'Winter 2026' } }
}]

describe('CoordinatorAssignments', () => {
  beforeEach(() => vi.mocked(supabase.from).mockReset())

  it('loads and lists assignments', async () => {
    vi.mocked(supabase.from).mockReturnValue(chainable(ASSIGNMENTS) as never)
    render(<CoordinatorAssignments />)

    expect(await screen.findByText('CS101')).toBeInTheDocument()
    expect(screen.getByText('Section 01')).toBeInTheDocument()
    expect(screen.getByText('Winter 2026')).toBeInTheDocument()
    expect(screen.getByText('Monday 9:00 AM')).toBeInTheDocument()
    expect(screen.getByText('Jane Doe')).toBeInTheDocument()
    expect(screen.getByText('3h')).toBeInTheDocument()
    expect(screen.getByText('filled')).toBeInTheDocument()
  })

  it('shows an empty state with no assignments', async () => {
    vi.mocked(supabase.from).mockReturnValue(chainable([]) as never)
    render(<CoordinatorAssignments />)
    expect(await screen.findByText('No assignments yet.')).toBeInTheDocument()
  })
})
