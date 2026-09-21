import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AdminAudit from './Audit'
import { supabase } from '../../lib/supabase'

vi.mock('../../lib/supabase', () => ({ supabase: { from: vi.fn() } }))

function chainable(data: unknown) {
  const chain: PromiseLike<{ data: unknown; error: null }> & Record<string, unknown> = {
    select: () => chain,
    order: () => chain,
    limit: () => chain,
    then: (resolve: (v: { data: unknown; error: null }) => unknown) => Promise.resolve({ data, error: null }).then(resolve)
  } as never
  return chain
}

const LOGS = [
  { id: 'log-1', action: 'created', entity: 'course', entity_id: 'c1', details: { code: 'CS101' }, created_at: '2026-01-05T10:00:00Z', profile: { full_name: 'Jane Doe', email: 'jane@example.com' } },
  { id: 'log-2', action: 'assigned', entity: 'assignment', entity_id: 'a1', details: { instructor: 'Bob Roe' }, created_at: '2026-01-05T11:00:00Z', profile: null },
]

describe('AdminAudit', () => {
  let fetchCount = 0

  beforeEach(() => {
    fetchCount = 0
    vi.mocked(supabase.from).mockReset()
  })

  function mountLogs(logs = LOGS) {
    vi.mocked(supabase.from).mockImplementation(() => {
      fetchCount++
      return chainable(logs) as never
    })
  }

  it('loads and lists logs with the action badge, user, details, and formatted date', async () => {
    mountLogs()
    render(<AdminAudit />)

    expect(await screen.findByText('created')).toBeInTheDocument()
    expect(screen.getByText('Jane Doe')).toBeInTheDocument()
    expect(screen.getByText('jane@example.com')).toBeInTheDocument()
    expect(screen.getByText(/course.*CS101/)).toBeInTheDocument()
  })

  it('shows "System" for a log with no associated profile', async () => {
    mountLogs()
    render(<AdminAudit />)
    expect(await screen.findByText('System')).toBeInTheDocument()
  })

  it('shows an empty state with no logs', async () => {
    mountLogs([])
    render(<AdminAudit />)
    expect(await screen.findByText('No logs found.')).toBeInTheDocument()
  })

  it('filters logs by entity type', async () => {
    mountLogs()
    const user = userEvent.setup()
    render(<AdminAudit />)
    await screen.findByText('created')

    await user.click(screen.getByRole('button', { name: 'Assignments' }))

    expect(screen.queryByText('created')).not.toBeInTheDocument()
    expect(screen.getByText('assigned')).toBeInTheDocument()
  })

  it('refetches when Refresh is clicked', async () => {
    mountLogs()
    const user = userEvent.setup()
    render(<AdminAudit />)
    await screen.findByText('created')
    const countAfterLoad = fetchCount

    await user.click(screen.getByRole('button', { name: 'Refresh' }))

    await waitFor(() => expect(fetchCount).toBeGreaterThan(countAfterLoad))
  })
})
