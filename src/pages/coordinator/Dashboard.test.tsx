import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import CoordinatorDashboard from './Dashboard'
import { supabase } from '../../lib/supabase'

vi.mock('../../lib/supabase', () => ({ supabase: { from: vi.fn() } }))

function chainable(data: unknown) {
  const chain: PromiseLike<{ data: unknown; error: null }> & Record<string, unknown> = {
    select: () => chain,
    then: (resolve: (v: { data: unknown; error: null }) => unknown) => Promise.resolve({ data, error: null }).then(resolve)
  } as never
  return chain
}

describe('CoordinatorDashboard', () => {
  beforeEach(() => vi.mocked(supabase.from).mockReset())

  it('shows a loading state before data arrives', () => {
    vi.mocked(supabase.from).mockReturnValue({ select: () => new Promise(() => {}) } as never)
    render(<CoordinatorDashboard />)
    expect(screen.getByText('Loading...')).toBeInTheDocument()
  })

  it('computes the section-status KPI cards from fetched data', async () => {
    vi.mocked(supabase.from).mockReturnValue(chainable([
      { status: 'filled' }, { status: 'filled' }, { status: 'partial' },
      { status: 'unassigned' }, { status: 'unassigned' }, { status: 'unassigned' }
    ]) as never)
    render(<CoordinatorDashboard />)

    expect(await screen.findByText('6')).toBeInTheDocument() // Total
    expect(screen.getByText('2')).toBeInTheDocument() // Filled
    expect(screen.getByText('1')).toBeInTheDocument() // Partial
    expect(screen.getByText('3')).toBeInTheDocument() // Unassigned
  })

  it('shows zero counts with no sections', async () => {
    vi.mocked(supabase.from).mockReturnValue(chainable([]) as never)
    render(<CoordinatorDashboard />)
    const zeros = await screen.findAllByText('0')
    expect(zeros).toHaveLength(4)
  })
})
