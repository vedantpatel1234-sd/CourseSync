import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import toast from 'react-hot-toast'
import AdminDrafts from './Drafts'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../stores/authStore'
import { logAction } from '../../lib/audit'
import { runAutoScheduler } from '../../lib/autoScheduler'

vi.mock('../../lib/supabase', () => ({ supabase: { from: vi.fn() } }))
vi.mock('../../stores/authStore', () => ({ useAuthStore: vi.fn() }))
vi.mock('../../lib/audit', () => ({ logAction: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../../lib/autoScheduler', () => ({ runAutoScheduler: vi.fn() }))
vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() })
}))

const ADMIN_USER = { id: 'admin-1', full_name: 'Admin', email: 'admin@example.com', role: 'admin' as const }

type Row = Record<string, unknown>

function createTableMock(initialRows: Row[], opts: { resolveInsert?: (row: Row) => Row } = {}) {
  let rows = [...initialRows]
  let nextId = 100

  function chain(op: 'select' | 'insert' | 'update' | 'delete', payload?: Row | Row[]) {
    const filters: { field: string; value: unknown }[] = []
    let selectSingle = false
    const builder = {
      select: () => builder,
      order: () => builder,
      eq: (field: string, value: unknown) => { filters.push({ field, value }); return builder },
      single: () => { selectSingle = true; return builder },
      then: (resolve: (v: { data?: Row[] | Row | null; error: { message: string; code?: string } | null }) => unknown) => {
        let result: { data?: Row[] | Row | null; error: { message: string; code?: string } | null }
        if (op === 'select') {
          const matched = rows.filter(r => filters.every(f => r[f.field] === f.value))
          result = { data: selectSingle ? (matched[0] || null) : matched, error: null }
        } else if (op === 'insert') {
          const items = Array.isArray(payload) ? payload : [payload as Row]
          const inserted = items.map((item, i) => {
            const row = { id: `new-${nextId + i}`, ...item }
            return opts.resolveInsert ? opts.resolveInsert(row) : row
          })
          nextId += items.length
          rows.push(...inserted)
          result = { data: selectSingle ? inserted[0] : inserted, error: null }
        } else if (op === 'update') {
          rows = rows.map(r => filters.every(f => r[f.field] === f.value) ? { ...r, ...payload } : r)
          result = { error: null }
        } else {
          rows = rows.filter(r => !filters.every(f => r[f.field] === f.value))
          result = { error: null }
        }
        return Promise.resolve(result).then(resolve)
      }
    }
    return builder
  }

  return {
    select: () => chain('select'),
    insert: (payload: Row | Row[]) => chain('insert', payload),
    update: (payload: Row) => chain('update', payload),
    delete: () => chain('delete'),
    getRows: () => rows
  }
}

const DRAFTS: Row[] = [
  { id: 'draft-1', name: 'Winter Draft v1', status: 'sandbox', is_ai_generated: false, created_at: '2026-01-01T10:00:00Z', published_at: null, term: { name: 'Winter 2026' }, created_by_profile: { full_name: 'Admin' } }
]
const TERMS: Row[] = [{ id: 'term-1', name: 'Winter 2026' }]

function mountSupabase(overrides: Partial<{ drafts: Row[]; terms: Row[] }> = {}) {
  const termList = overrides.terms ?? TERMS
  const tables: Record<string, ReturnType<typeof createTableMock>> = {
    drafts: createTableMock(overrides.drafts ?? DRAFTS, {
      // Real supabase resolves the term:terms(name)/created_by_profile:profiles(...) embeds —
      // simulate that so a freshly inserted draft renders the same as a fetched one.
      resolveInsert: (row) => {
        const term = termList.find(t => t.id === row.term_id)
        return { ...row, term: term ? { name: term.name } : undefined, created_by_profile: { full_name: 'Admin' } }
      }
    }),
    terms: createTableMock(termList),
    assignments: createTableMock([])
  }
  vi.mocked(supabase.from).mockImplementation(((table: string) => tables[table]) as never)
  return tables
}

function renderDrafts() {
  return render(<MemoryRouter><AdminDrafts /></MemoryRouter>)
}

describe('AdminDrafts', () => {
  beforeEach(() => {
    vi.mocked(useAuthStore).mockReturnValue({ user: ADMIN_USER } as never)
    vi.mocked(toast).mockReset()
    vi.mocked(toast.error).mockReset()
    vi.mocked(toast.success).mockReset()
    vi.mocked(logAction).mockClear()
    vi.mocked(runAutoScheduler).mockReset()
  })

  it('loads and lists existing drafts', async () => {
    mountSupabase()
    renderDrafts()
    expect(await screen.findByText('Winter Draft v1')).toBeInTheDocument()
    expect(screen.getByText('sandbox')).toBeInTheDocument()
  })

  it('shows an empty state with no drafts', async () => {
    mountSupabase({ drafts: [] })
    renderDrafts()
    expect(await screen.findByText('No drafts yet. Create one above to get started.')).toBeInTheDocument()
  })

  it('validates the new-draft form', async () => {
    mountSupabase({ drafts: [] })
    const user = userEvent.setup()
    renderDrafts()
    await screen.findByText('No drafts yet. Create one above to get started.')

    await user.click(screen.getByRole('button', { name: 'Create Draft' }))

    expect(await screen.findByText('Name must be at least 2 characters')).toBeInTheDocument()
    expect(screen.getByText('Please select a term')).toBeInTheDocument()
  })

  it('creates a manual draft (not AI-generated) and refreshes the list', async () => {
    mountSupabase({ drafts: [] })
    const user = userEvent.setup()
    renderDrafts()
    await screen.findByText('No drafts yet. Create one above to get started.')

    await user.type(screen.getByPlaceholderText('e.g. Winter 2026 Draft v1'), 'My New Draft')
    const [, manualTermSelect] = document.querySelectorAll('select')
    await user.selectOptions(manualTermSelect, 'term-1')
    await user.click(screen.getByRole('button', { name: 'Create Draft' }))

    expect(await screen.findByText('My New Draft')).toBeInTheDocument()
    expect(toast.success).toHaveBeenCalledWith('Draft created!')
    expect(logAction).toHaveBeenCalledWith('admin-1', 'created', 'draft', undefined, { name: 'My New Draft' })
  })

  it('requires a term before generating with AI', async () => {
    mountSupabase()
    renderDrafts()
    await screen.findByText('Winter Draft v1')

    expect(screen.getByRole('button', { name: 'Generate Schedule' })).toBeDisabled()
  })

  it('shows an info toast and creates no draft when every section is already assigned', async () => {
    vi.mocked(runAutoScheduler).mockResolvedValue({ accepted: [], rejected: [], noSectionsFound: true })
    const tables = mountSupabase()
    const insertSpy = vi.spyOn(tables.drafts, 'insert')
    const user = userEvent.setup()
    renderDrafts()
    await screen.findByText('Winter Draft v1')

    const [aiTermSelect] = document.querySelectorAll('select')
    await user.selectOptions(aiTermSelect, 'term-1')
    await user.click(screen.getByRole('button', { name: 'Generate Schedule' }))

    await waitFor(() => expect(toast).toHaveBeenCalledWith('All sections in Winter 2026 are already assigned!', { icon: 'ℹ️' }))
    expect(insertSpy).not.toHaveBeenCalled()
  })

  it('shows rejected reasons without a draft link when the AI could not confidently assign anything', async () => {
    vi.mocked(runAutoScheduler).mockResolvedValue({
      accepted: [],
      rejected: [{ sectionLabel: 'CS101 — Section 01', reason: 'No qualified instructor available.' }],
      noSectionsFound: false
    })
    mountSupabase()
    const user = userEvent.setup()
    renderDrafts()
    await screen.findByText('Winter Draft v1')

    const [aiTermSelect] = document.querySelectorAll('select')
    await user.selectOptions(aiTermSelect, 'term-1')
    await user.click(screen.getByRole('button', { name: 'Generate Schedule' }))

    expect(await screen.findByText('No sections could be confidently assigned')).toBeInTheDocument()
    expect(screen.getByText(/No qualified instructor available/)).toBeInTheDocument()
    expect(screen.queryByText('View Draft →')).not.toBeInTheDocument()
    expect(toast.error).toHaveBeenCalledWith('The AI could not confidently assign any section — see reasons below.')
  })

  it('generates a full AI draft: creates the draft, inserts accepted assignments with rationale, and links to it', async () => {
    vi.mocked(runAutoScheduler).mockResolvedValue({
      accepted: [{
        sectionId: 'sec-1', instructorId: 'inst-1', hours: 3,
        sectionLabel: 'CS101 — Section 01', instructorName: 'Jane Doe',
        dayTime: 'Monday 9:00 AM', rationale: 'Jane is qualified and available.'
      }],
      rejected: [],
      noSectionsFound: false
    })
    const tables = mountSupabase()
    const assignmentsInsertSpy = vi.spyOn(tables.assignments, 'insert')
    const user = userEvent.setup()
    renderDrafts()
    await screen.findByText('Winter Draft v1')

    const [aiTermSelect] = document.querySelectorAll('select')
    await user.selectOptions(aiTermSelect, 'term-1')
    await user.click(screen.getByRole('button', { name: 'Generate Schedule' }))

    expect(await screen.findByText(/1 assignment\(s\) generated in/)).toBeInTheDocument()
    expect(assignmentsInsertSpy).toHaveBeenCalledWith([expect.objectContaining({
      instructor_id: 'inst-1', section_id: 'sec-1', hours_assigned: 3,
      assigned_by: 'admin-1', status: 'active', ai_rationale: 'Jane is qualified and available.'
    })])
    expect(logAction).toHaveBeenCalledWith('admin-1', 'ai_generated', 'draft', expect.any(String), expect.objectContaining({ count: 1, rejected: 0 }))
    expect(toast.success).toHaveBeenCalledWith('Generated 1 assignment(s)!')
    expect(screen.getByText('View Draft →')).toBeInTheDocument()
  })

  it('deletes a draft, clearing its assignments first', async () => {
    const tables = mountSupabase()
    const assignmentsDeleteSpy = vi.spyOn(tables.assignments, 'delete')
    const user = userEvent.setup()
    renderDrafts()
    await screen.findByText('Winter Draft v1')

    await user.click(screen.getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(screen.queryByText('Winter Draft v1')).not.toBeInTheDocument())
    expect(assignmentsDeleteSpy).toHaveBeenCalled()
    expect(toast.success).toHaveBeenCalledWith('Draft deleted!')
    expect(logAction).toHaveBeenCalledWith('admin-1', 'deleted', 'draft', 'draft-1', { name: 'Winter Draft v1' })
  })

  it('shows the Open & Assign action for a sandbox draft', async () => {
    mountSupabase()
    renderDrafts()
    const row = (await screen.findByText('Winter Draft v1')).closest('div')!.parentElement!
    expect(within(row).getByText('Open & Assign')).toBeInTheDocument()
  })
})
