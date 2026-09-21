import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import toast from 'react-hot-toast'
import AdminDigest from './Digest'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../stores/authStore'
import { logAction } from '../../lib/audit'
import { generateWeeklyDigest } from '../../lib/weeklyDigest'

vi.mock('../../lib/supabase', () => ({ supabase: { from: vi.fn() } }))
vi.mock('../../stores/authStore', () => ({ useAuthStore: vi.fn() }))
vi.mock('../../lib/audit', () => ({ logAction: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../../lib/weeklyDigest', () => ({ generateWeeklyDigest: vi.fn() }))
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }))

const ADMIN_USER = { id: 'admin-1', full_name: 'Admin', email: 'admin@example.com', role: 'admin' as const }

type Row = Record<string, unknown>

function createTableMock(initialRows: Row[]) {
  let rows = [...initialRows]
  let nextId = 100

  function chain(op: 'select' | 'insert', payload?: Row) {
    const builder = {
      select: () => builder,
      order: () => builder,
      limit: () => builder,
      then: (resolve: (v: { data?: Row[]; error: { message: string } | null }) => unknown) => {
        let result: { data?: Row[]; error: { message: string } | null }
        if (op === 'select') {
          result = { data: rows, error: null }
        } else {
          rows = [{ id: `digest-${nextId++}`, created_at: new Date().toISOString(), ...payload }, ...rows]
          result = { error: null }
        }
        return Promise.resolve(result).then(resolve)
      }
    }
    return builder
  }

  return { select: () => chain('select'), insert: (payload: Row) => chain('insert', payload), getRows: () => rows }
}

const DIGESTS: Row[] = [{
  id: 'digest-1', created_at: '2026-01-01T10:00:00Z',
  summary: 'All quiet this week.',
  highlights: [{ severity: 'high', text: 'CS101 Section 01 is unfilled and starts soon.' }],
  stats: { unfilledSections: [{}], overloadedInstructors: [], underutilizedInstructors: [{}, {}], generatedAt: '2026-01-01T10:00:00Z' }
}]

function mountSupabase(overrides: Partial<{ digests: Row[] }> = {}) {
  const table = createTableMock(overrides.digests ?? DIGESTS)
  vi.mocked(supabase.from).mockImplementation(() => table as never)
  return table
}

describe('AdminDigest', () => {
  beforeEach(() => {
    vi.mocked(useAuthStore).mockReturnValue({ user: ADMIN_USER } as never)
    vi.mocked(toast.error).mockReset()
    vi.mocked(toast.success).mockReset()
    vi.mocked(logAction).mockClear()
    vi.mocked(generateWeeklyDigest).mockReset()
  })

  it('loads and displays existing digests with severity labels and stat counts', async () => {
    mountSupabase()
    render(<AdminDigest />)
    expect(await screen.findByText('All quiet this week.')).toBeInTheDocument()
    expect(screen.getByText('High')).toBeInTheDocument()
    expect(screen.getByText('CS101 Section 01 is unfilled and starts soon.')).toBeInTheDocument()
    expect(screen.getByText('1 unfilled section(s)')).toBeInTheDocument()
    expect(screen.getByText('0 instructor(s) near/over cap')).toBeInTheDocument()
    expect(screen.getByText('2 instructor(s) underutilized')).toBeInTheDocument()
  })

  it('shows an empty state with no digests', async () => {
    mountSupabase({ digests: [] })
    render(<AdminDigest />)
    expect(await screen.findByText('No digests yet. Generate one above to get started.')).toBeInTheDocument()
  })

  it('generates a digest, saves it, logs it, and refreshes the list', async () => {
    vi.mocked(generateWeeklyDigest).mockResolvedValue({
      summary: 'Two sections need attention.',
      highlights: [{ severity: 'medium', text: 'Jane Doe is near her hour cap.' }],
      stats: {
        unfilledSections: [
          { courseCode: 'CS101', sectionNumber: '01', termName: 'Winter 2026', status: 'unassigned', daysUntilStart: 5 },
          { courseCode: 'CS102', sectionNumber: '01', termName: 'Winter 2026', status: 'unassigned', daysUntilStart: 10 }
        ],
        overloadedInstructors: [{ name: 'Jane Doe', hoursAssigned: 38, maxHours: 40, percent: 95 }],
        underutilizedInstructors: [],
        generatedAt: '2026-01-08T00:00:00Z'
      }
    })
    mountSupabase({ digests: [] })
    const user = userEvent.setup()
    render(<AdminDigest />)
    await screen.findByText('No digests yet. Generate one above to get started.')

    await user.click(screen.getByRole('button', { name: 'Generate Digest' }))

    expect(await screen.findByText('Two sections need attention.')).toBeInTheDocument()
    expect(toast.success).toHaveBeenCalledWith('Digest generated!')
    expect(logAction).toHaveBeenCalledWith('admin-1', 'ai_generated', 'digest', undefined, { highlightCount: 1, unfilledCount: 2 })
  })

  it('shows an error toast when saving the generated digest fails', async () => {
    vi.mocked(generateWeeklyDigest).mockResolvedValue({
      summary: 'Summary', highlights: [],
      stats: { unfilledSections: [], overloadedInstructors: [], underutilizedInstructors: [], generatedAt: '2026-01-08T00:00:00Z' }
    })
    const table = createTableMock([])
    vi.mocked(supabase.from).mockImplementation(() => ({
      ...table,
      insert: () => ({ then: (resolve: (v: { error: { message: string } }) => unknown) => Promise.resolve({ error: { message: 'db error' } }).then(resolve) })
    }) as never)
    const user = userEvent.setup()
    render(<AdminDigest />)
    await screen.findByText('No digests yet. Generate one above to get started.')

    await user.click(screen.getByRole('button', { name: 'Generate Digest' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('db error'))
    expect(logAction).not.toHaveBeenCalled()
  })

  it('shows an error toast when the AI call itself fails', async () => {
    vi.mocked(generateWeeklyDigest).mockRejectedValue(new Error('Your credit balance is too low.'))
    mountSupabase({ digests: [] })
    const user = userEvent.setup()
    render(<AdminDigest />)
    await screen.findByText('No digests yet. Generate one above to get started.')

    await user.click(screen.getByRole('button', { name: 'Generate Digest' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Could not generate digest: Your credit balance is too low.'))
  })
})
