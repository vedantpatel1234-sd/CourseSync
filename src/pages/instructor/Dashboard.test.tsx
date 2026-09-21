import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import InstructorDashboard from './Dashboard'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../stores/authStore'

vi.mock('../../lib/supabase', () => ({ supabase: { from: vi.fn() } }))
vi.mock('../../stores/authStore', () => ({ useAuthStore: vi.fn() }))

const INSTRUCTOR_USER = { id: 'inst-1', full_name: 'Jane Doe', email: 'jane@example.com', role: 'instructor' as const }

function chainable(data: unknown) {
  const chain: PromiseLike<{ data: unknown; error: null }> & Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    is: () => chain,
    neq: () => chain,
    single: () => chain,
    then: (resolve: (v: { data: unknown; error: null }) => unknown) => Promise.resolve({ data, error: null }).then(resolve)
  } as never
  return chain
}

function mockTables(overrides: Partial<{ instructor_profiles: unknown; assignments: unknown[] }> = {}) {
  const tables: Record<string, unknown> = {
    instructor_profiles: overrides.instructor_profiles ?? { max_hours_per_term: 40 },
    assignments: overrides.assignments ?? []
  }
  vi.mocked(supabase.from).mockImplementation(((table: string) => chainable(tables[table])) as never)
}

describe('InstructorDashboard', () => {
  beforeEach(() => {
    vi.mocked(useAuthStore).mockReturnValue({ user: INSTRUCTOR_USER } as never)
    vi.mocked(supabase.from).mockReset()
  })

  it('computes stat cards and lists assignments', async () => {
    mockTables({
      assignments: [{
        id: 'a1', hours_assigned: 6, status: 'active',
        section: { section_number: '01', hours_required: 3, status: 'filled', day_of_week: 'Monday', time_slot: '9:00 AM', course: { code: 'CS101', name: 'Intro to CS' }, term: { name: 'Winter 2026' } }
      }]
    })
    render(<InstructorDashboard />)

    expect(await screen.findByText('CS101')).toBeInTheDocument()
    expect(screen.getByText('Section 01')).toBeInTheDocument()
    expect(screen.getAllByText('6h')).toHaveLength(2) // Hours Assigned card + table row
    expect(screen.getByText('34h')).toBeInTheDocument() // Hours Remaining: 40 - 6
    expect(screen.getByText('6/40h')).toBeInTheDocument() // Workload bar text
  })

  it('shows an empty state with no assignments', async () => {
    mockTables()
    render(<InstructorDashboard />)
    expect(await screen.findByText('No assignments yet.')).toBeInTheDocument()
  })

  it('defaults max hours to 40 with no instructor_profiles row', async () => {
    mockTables({ instructor_profiles: null })
    render(<InstructorDashboard />)
    expect(await screen.findByText('40h')).toBeInTheDocument() // Hours Remaining: 40 - 0
  })
})
