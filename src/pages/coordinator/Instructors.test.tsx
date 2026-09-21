import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import CoordinatorInstructors from './Instructors'
import { supabase } from '../../lib/supabase'

vi.mock('../../lib/supabase', () => ({ supabase: { from: vi.fn() } }))

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

function mockTables(overrides: Partial<{ profiles: unknown[]; assignments: unknown[] }> = {}) {
  const tables: Record<string, unknown[]> = {
    profiles: overrides.profiles ?? [],
    assignments: overrides.assignments ?? []
  }
  vi.mocked(supabase.from).mockImplementation(((table: string) => chainable(tables[table] ?? [])) as never)
}

describe('CoordinatorInstructors', () => {
  beforeEach(() => vi.mocked(supabase.from).mockReset())

  it('loads and lists instructor workload, computed from live assignments only', async () => {
    mockTables({
      profiles: [{ id: 'i1', full_name: 'Jane Doe', email: 'jane@example.com', instructor_profiles: { max_hours_per_term: 40, department: 'CS', title: 'Lecturer' } }],
      assignments: [{ instructor_id: 'i1', hours_assigned: 10 }]
    })
    render(<CoordinatorInstructors />)

    expect(await screen.findByText('Jane Doe')).toBeInTheDocument()
    expect(screen.getByText('jane@example.com')).toBeInTheDocument()
    expect(screen.getByText('Lecturer — CS')).toBeInTheDocument()
    expect(screen.getByText('10/40h')).toBeInTheDocument()
  })

  it('defaults hours assigned to 0 for an instructor with no live assignments', async () => {
    mockTables({
      profiles: [{ id: 'i1', full_name: 'Bob Roe', email: 'bob@example.com', instructor_profiles: null }]
    })
    render(<CoordinatorInstructors />)

    expect(await screen.findByText('0/40h')).toBeInTheDocument()
  })
})
