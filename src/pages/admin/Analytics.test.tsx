import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import AdminAnalytics from './Analytics'
import { supabase } from '../../lib/supabase'

vi.mock('../../lib/supabase', () => ({ supabase: { from: vi.fn() } }))

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

function mockTables(overrides: Partial<{ sections: unknown[]; profiles: unknown[]; assignments: unknown[] }> = {}) {
  const tables: Record<string, unknown[]> = {
    sections: overrides.sections ?? [],
    profiles: overrides.profiles ?? [],
    assignments: overrides.assignments ?? []
  }
  vi.mocked(supabase.from).mockImplementation(((table: string) => chainable(tables[table] ?? [])) as never)
}

describe('AdminAnalytics', () => {
  beforeEach(() => {
    vi.mocked(supabase.from).mockReset()
  })

  it('shows a loading state before data arrives', () => {
    vi.mocked(supabase.from).mockImplementation(() => ({
      select: () => new Promise(() => {}) // never resolves
    }) as never)
    render(<AdminAnalytics />)
    expect(screen.getByText('Loading...')).toBeInTheDocument()
  })

  it('computes KPI cards from real fetched data', async () => {
    mockTables({
      sections: [{ status: 'filled' }, { status: 'filled' }, { status: 'partial' }, { status: 'unassigned' }],
      profiles: [
        { id: 'i1', full_name: 'Jane Doe', instructor_profiles: { max_hours_per_term: 40 } },
        { id: 'i2', full_name: 'Bob Roe', instructor_profiles: null }
      ],
      assignments: [{ instructor_id: 'i1', hours_assigned: 10 }]
    })
    render(<AdminAnalytics />)

    expect(await screen.findByText('4')).toBeInTheDocument() // Total Sections
    expect(screen.getByText('50%')).toBeInTheDocument() // Fill Rate: 2/4
    expect(screen.getByText('2')).toBeInTheDocument() // Instructors count
    expect(screen.getByText('1')).toBeInTheDocument() // Unassigned count
  })

  it('shows a 0% fill rate instead of dividing by zero when there are no sections', async () => {
    mockTables({ sections: [] })
    render(<AdminAnalytics />)
    expect(await screen.findByText('0%')).toBeInTheDocument()
  })

  it('shows "No data yet" for the pie chart when there is nothing to plot', async () => {
    mockTables({ sections: [] })
    render(<AdminAnalytics />)
    expect(await screen.findByText('No data yet')).toBeInTheDocument()
  })
})
