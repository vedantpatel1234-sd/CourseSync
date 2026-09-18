import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import toast from 'react-hot-toast'
import AdminTerms from './Terms'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../stores/authStore'
import { logAction } from '../../lib/audit'

vi.mock('../../lib/supabase', () => ({
  supabase: { from: vi.fn() }
}))

vi.mock('../../stores/authStore', () => ({
  useAuthStore: vi.fn()
}))

vi.mock('../../lib/audit', () => ({
  logAction: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn() }
}))

const ADMIN_USER = { id: 'admin-1', full_name: 'Jane Doe', email: 'jane@example.com', role: 'admin' as const }

interface Term {
  id: string
  name: string
  start_date: string
  end_date: string
  is_active: boolean
}

type Filter = { field: string; kind: 'eq' | 'neq'; value: unknown }

function matches(row: Term, filters: Filter[]) {
  return filters.every(f => {
    const rowValue = (row as unknown as Record<string, unknown>)[f.field]
    return f.kind === 'eq' ? rowValue === f.value : rowValue !== f.value
  })
}

// Simulates the real supabase-js terms table closely enough for Terms.tsx's
// select/insert/update/delete + eq/neq/order chains, so each test can assert
// on the state the page would actually re-fetch after a mutation.
function createTermsTableMock(initialRows: Term[]) {
  let rows = [...initialRows]
  let nextId = 100
  let forceDeleteErrorFor: string | null = null

  function buildChain(op: 'select' | 'insert' | 'update' | 'delete', payload?: Partial<Term>) {
    const filters: Filter[] = []
    const chain = {
      select: () => chain,
      order: (field: string) => {
        rows = [...rows].sort((a, b) => String((a as unknown as Record<string, unknown>)[field]).localeCompare(String((b as unknown as Record<string, unknown>)[field])))
        return chain
      },
      eq: (field: string, value: unknown) => { filters.push({ field, kind: 'eq', value }); return chain },
      neq: (field: string, value: unknown) => { filters.push({ field, kind: 'neq', value }); return chain },
      then: (resolve: (v: { data?: Term[]; error: { code?: string; message: string } | null }) => unknown) => {
        let result: { data?: Term[]; error: { code?: string; message: string } | null }
        if (op === 'select') {
          result = { data: rows.filter(r => matches(r, filters)), error: null }
        } else if (op === 'insert') {
          const row: Term = { id: `term-${nextId++}`, name: '', start_date: '', end_date: '', is_active: false, ...payload } as Term
          rows.push(row)
          result = { error: null }
        } else if (op === 'update') {
          rows = rows.map(r => matches(r, filters) ? { ...r, ...payload } : r)
          result = { error: null }
        } else {
          const target = rows.find(r => matches(r, filters))
          if (target && target.id === forceDeleteErrorFor) {
            result = { error: { code: '23503', message: 'update or delete on table "terms" violates foreign key constraint' } }
          } else {
            rows = rows.filter(r => !matches(r, filters))
            result = { error: null }
          }
        }
        return Promise.resolve(result).then(resolve)
      }
    }
    return chain
  }

  return {
    select: () => buildChain('select'),
    insert: (payload: Partial<Term>) => buildChain('insert', payload),
    update: (payload: Partial<Term>) => buildChain('update', payload),
    delete: () => buildChain('delete'),
    getRows: () => rows,
    blockDeleteFor: (id: string) => { forceDeleteErrorFor = id }
  }
}

function mountSupabase(initialRows: Term[]) {
  const table = createTermsTableMock(initialRows)
  vi.mocked(supabase.from).mockImplementation(() => table as never)
  return table
}

const SAMPLE_TERMS: Term[] = [
  { id: 'term-1', name: 'Fall 2025', start_date: '2025-09-01', end_date: '2025-12-15', is_active: true },
  { id: 'term-2', name: 'Winter 2026', start_date: '2026-01-05', end_date: '2026-04-20', is_active: false }
]

describe('AdminTerms', () => {
  beforeEach(() => {
    vi.mocked(useAuthStore).mockReturnValue({ user: ADMIN_USER } as never)
    vi.mocked(toast.error).mockReset()
    vi.mocked(toast.success).mockReset()
    vi.mocked(logAction).mockClear()
  })

  it('loads and lists existing terms with the active badge on the right row', async () => {
    mountSupabase(SAMPLE_TERMS)
    render(<AdminTerms />)

    expect(await screen.findByText('Fall 2025')).toBeInTheDocument()
    expect(screen.getByText('Winter 2026')).toBeInTheDocument()

    const fallRow = screen.getByText('Fall 2025').closest('tr')!
    const winterRow = screen.getByText('Winter 2026').closest('tr')!
    expect(within(fallRow).getByText('✓ Active')).toBeInTheDocument()
    expect(within(winterRow).getByRole('button', { name: 'Set Active' })).toBeInTheDocument()
  })

  it('shows an empty state when there are no terms', async () => {
    mountSupabase([])
    render(<AdminTerms />)
    expect(await screen.findByText('No terms yet. Add one above.')).toBeInTheDocument()
  })

  it('validates the add-term form before calling supabase', async () => {
    const table = mountSupabase([])
    const insertSpy = vi.spyOn(table, 'insert')
    const user = userEvent.setup()
    render(<AdminTerms />)
    await screen.findByText('No terms yet. Add one above.')

    await user.click(screen.getByRole('button', { name: 'Add Term' }))

    expect(await screen.findByText('Name is required')).toBeInTheDocument()
    expect(screen.getByText('Start date is required')).toBeInTheDocument()
    expect(screen.getByText('End date is required')).toBeInTheDocument()
    expect(insertSpy).not.toHaveBeenCalled()
  })

  it('rejects an end date on or before the start date', async () => {
    mountSupabase([])
    const user = userEvent.setup()
    render(<AdminTerms />)
    await screen.findByText('No terms yet. Add one above.')

    await user.type(screen.getByPlaceholderText('Fall 2026'), 'Spring 2026')
    const dateInputs = document.querySelectorAll('input[type="date"]')
    fireEvent.change(dateInputs[0], { target: { value: '2026-05-01' } })
    fireEvent.change(dateInputs[1], { target: { value: '2026-04-01' } })
    await user.click(screen.getByRole('button', { name: 'Add Term' }))

    expect(await screen.findByText('End date must be after start date')).toBeInTheDocument()
  })

  it('adds a new term, logs it, and shows it in the refreshed list', async () => {
    mountSupabase([])
    const user = userEvent.setup()
    render(<AdminTerms />)
    await screen.findByText('No terms yet. Add one above.')

    await user.type(screen.getByPlaceholderText('Fall 2026'), 'Spring 2026')
    const dateInputs = document.querySelectorAll('input[type="date"]')
    fireEvent.change(dateInputs[0], { target: { value: '2026-01-10' } })
    fireEvent.change(dateInputs[1], { target: { value: '2026-04-30' } })
    await user.click(screen.getByRole('button', { name: 'Add Term' }))

    expect(await screen.findByText('Spring 2026')).toBeInTheDocument()
    expect(toast.success).toHaveBeenCalledWith('Term added!')
    expect(logAction).toHaveBeenCalledWith('admin-1', 'created', 'term', undefined, { name: 'Spring 2026' })
    // New terms are never auto-activated.
    expect(within(screen.getByText('Spring 2026').closest('tr')!).getByRole('button', { name: 'Set Active' })).toBeInTheDocument()
  })

  it('setting a term active deactivates every other term (exclusive)', async () => {
    mountSupabase(SAMPLE_TERMS)
    const user = userEvent.setup()
    render(<AdminTerms />)
    await screen.findByText('Fall 2025')

    await user.click(screen.getByRole('button', { name: 'Set Active' }))

    await waitFor(() => {
      const winterRow = screen.getByText('Winter 2026').closest('tr')!
      expect(within(winterRow).getByText('✓ Active')).toBeInTheDocument()
    })
    const fallRow = screen.getByText('Fall 2025').closest('tr')!
    expect(within(fallRow).getByRole('button', { name: 'Set Active' })).toBeInTheDocument()
    expect(logAction).toHaveBeenCalledWith('admin-1', 'activated', 'term', 'term-2', { name: 'Winter 2026' })
  })

  it('edits a term in place', async () => {
    mountSupabase(SAMPLE_TERMS)
    const user = userEvent.setup()
    render(<AdminTerms />)
    await screen.findByText('Winter 2026')

    const winterRow = screen.getByText('Winter 2026').closest('tr')!
    await user.click(within(winterRow).getByRole('button', { name: 'Edit' }))

    const nameInput = within(winterRow).getByDisplayValue('Winter 2026')
    await user.clear(nameInput)
    await user.type(nameInput, 'Winter Term 2026')
    await user.click(within(winterRow).getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('Winter Term 2026')).toBeInTheDocument()
    expect(toast.success).toHaveBeenCalledWith('Term updated!')
    expect(logAction).toHaveBeenCalledWith('admin-1', 'edited', 'term', 'term-2', { name: 'Winter Term 2026' })
  })

  it('rejects an invalid edit without calling supabase', async () => {
    const table = mountSupabase(SAMPLE_TERMS)
    const updateSpy = vi.spyOn(table, 'update')
    const user = userEvent.setup()
    render(<AdminTerms />)
    await screen.findByText('Winter 2026')

    const winterRow = screen.getByText('Winter 2026').closest('tr')!
    await user.click(within(winterRow).getByRole('button', { name: 'Edit' }))
    const nameInput = within(winterRow).getByDisplayValue('Winter 2026')
    await user.clear(nameInput)
    await user.click(within(winterRow).getByRole('button', { name: 'Save' }))

    expect(toast.error).toHaveBeenCalledWith('Please check the name and dates')
    expect(updateSpy).not.toHaveBeenCalled()
  })

  it('deletes a term', async () => {
    mountSupabase(SAMPLE_TERMS)
    const user = userEvent.setup()
    render(<AdminTerms />)
    await screen.findByText('Winter 2026')

    const winterRow = screen.getByText('Winter 2026').closest('tr')!
    await user.click(within(winterRow).getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(screen.queryByText('Winter 2026')).not.toBeInTheDocument())
    expect(toast.success).toHaveBeenCalledWith('Term deleted!')
    expect(logAction).toHaveBeenCalledWith('admin-1', 'deleted', 'term', 'term-2', { name: 'Winter 2026' })
  })

  it('shows a friendly message and keeps the row when delete is blocked by a foreign key', async () => {
    const table = mountSupabase(SAMPLE_TERMS)
    table.blockDeleteFor('term-2')
    const user = userEvent.setup()
    render(<AdminTerms />)
    await screen.findByText('Winter 2026')

    const winterRow = screen.getByText('Winter 2026').closest('tr')!
    await user.click(within(winterRow).getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(
      "Can't delete Winter 2026 — it still has sections. Delete or reassign those sections first."
    ))
    expect(screen.getByText('Winter 2026')).toBeInTheDocument()
  })
})
