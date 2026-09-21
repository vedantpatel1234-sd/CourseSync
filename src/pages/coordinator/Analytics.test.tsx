import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CoordinatorAnalytics from './Analytics'
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

function mockTables(overrides: Partial<{ sections: unknown[]; profiles: unknown[]; assignments: unknown[] }> = {}) {
  const tables: Record<string, unknown[]> = {
    sections: overrides.sections ?? [],
    profiles: overrides.profiles ?? [],
    assignments: overrides.assignments ?? []
  }
  vi.mocked(supabase.from).mockImplementation(((table: string) => chainable(tables[table] ?? [])) as never)
}

describe('CoordinatorAnalytics', () => {
  beforeEach(() => vi.mocked(supabase.from).mockReset())

  it('computes KPI cards from fetched data', async () => {
    mockTables({
      sections: [{ status: 'filled' }, { status: 'unassigned' }],
      profiles: [{ id: 'i1', full_name: 'Jane Doe', instructor_profiles: { max_hours_per_term: 40 } }]
    })
    render(<CoordinatorAnalytics />)

    expect(await screen.findByText('2')).toBeInTheDocument() // Total Sections
    expect(screen.getByText('50%')).toBeInTheDocument()
    expect(screen.getAllByText('1')).toHaveLength(2) // Instructors and Unassigned both 1
  })

  it('exports a CSV of instructor workload when clicked', async () => {
    mockTables({
      profiles: [{ id: 'i1', full_name: 'Jane Doe', instructor_profiles: { max_hours_per_term: 40 } }],
      assignments: [{ instructor_id: 'i1', hours_assigned: 10 }]
    })
    const createObjectURL = vi.fn().mockReturnValue('blob:mock-url')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL })
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    const user = userEvent.setup()
    render(<CoordinatorAnalytics />)
    await screen.findByText('Export CSV')

    await user.click(screen.getByRole('button', { name: 'Export CSV' }))

    expect(createObjectURL).toHaveBeenCalled()
    const blob = createObjectURL.mock.calls[0][0] as Blob
    expect(blob.type).toBe('text/csv')
    expect(clickSpy).toHaveBeenCalled()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url')

    clickSpy.mockRestore()
    vi.unstubAllGlobals()
  })
})
