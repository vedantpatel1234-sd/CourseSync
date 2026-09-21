import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import toast from 'react-hot-toast'
import AdminDraftDetail from './DraftDetail'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../stores/authStore'
import { logAction } from '../../lib/audit'
import { notifyInstructor } from '../../lib/notifications'

vi.mock('../../lib/supabase', () => ({ supabase: { from: vi.fn() } }))
vi.mock('../../stores/authStore', () => ({ useAuthStore: vi.fn() }))
vi.mock('../../lib/audit', () => ({ logAction: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../../lib/notifications', () => ({ notifyInstructor: vi.fn().mockResolvedValue(undefined) }))
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }))

const ADMIN_USER = { id: 'admin-1', full_name: 'Admin', email: 'admin@example.com', role: 'admin' as const }

type Row = Record<string, unknown>

function createTableMock(initialRows: Row[], opts: { resolveInsert?: (row: Row) => Row } = {}) {
  let rows = [...initialRows]
  let nextId = 100

  function chain(op: 'select' | 'insert' | 'update' | 'delete', payload?: Row) {
    const filters: { field: string; kind: 'eq' | 'neq'; value: unknown }[] = []
    const matches = (r: Row) => filters.every(f => f.kind === 'eq' ? r[f.field] === f.value : r[f.field] !== f.value)
    let selectSingle = false
    const builder = {
      select: () => builder,
      order: () => builder,
      eq: (field: string, value: unknown) => { filters.push({ field, kind: 'eq', value }); return builder },
      neq: (field: string, value: unknown) => { filters.push({ field, kind: 'neq', value }); return builder },
      is: (field: string, value: unknown) => { filters.push({ field, kind: 'eq', value }); return builder },
      single: () => { selectSingle = true; return builder },
      then: (resolve: (v: { data?: Row[] | Row | null; error: { message: string } | null }) => unknown) => {
        let result: { data?: Row[] | Row | null; error: { message: string } | null }
        if (op === 'select') {
          const matched = rows.filter(matches)
          result = { data: selectSingle ? (matched[0] || null) : matched, error: null }
        } else if (op === 'insert') {
          const row = opts.resolveInsert ? opts.resolveInsert({ id: `new-${nextId++}`, ...payload }) : { id: `new-${nextId++}`, ...payload }
          rows.push(row)
          result = { error: null }
        } else if (op === 'update') {
          rows = rows.map(r => matches(r) ? { ...r, ...payload } : r)
          result = { error: null }
        } else {
          rows = rows.filter(r => !matches(r))
          result = { error: null }
        }
        return Promise.resolve(result).then(resolve)
      }
    }
    return builder
  }

  return {
    select: () => chain('select'),
    insert: (payload: Row) => chain('insert', payload),
    update: (payload: Row) => chain('update', payload),
    delete: () => chain('delete'),
    getRows: () => rows
  }
}

const DRAFT: Row = { id: 'draft-1', name: 'Winter Draft', status: 'sandbox', is_ai_generated: false, term_id: 'term-1', published_at: null, term: { name: 'Winter 2026' } }
const SECTIONS: Row[] = [
  { id: 'sec-1', term_id: 'term-1', section_number: '01', hours_required: 3, status: 'unassigned', day_of_week: 'Monday', time_slot: '9:00 AM', course: { code: 'CS101', name: 'Intro to CS' } },
  { id: 'sec-2', term_id: 'term-1', section_number: '01', hours_required: 3, status: 'filled', day_of_week: 'Tuesday', time_slot: '10:00 AM', course: { code: 'CS102', name: 'Data Structures' } }
]
const INSTRUCTORS: Row[] = [
  { id: 'inst-1', full_name: 'Jane Doe', email: 'jane@example.com', role: 'instructor', instructor_profiles: { max_hours_per_term: 40 } },
  { id: 'inst-2', full_name: 'Bob Roe', email: 'bob@example.com', role: 'instructor', instructor_profiles: { max_hours_per_term: 40 } }
]
const LIVE_ASSIGNMENT: Row = {
  id: 'live-1', hours_assigned: 3, instructor_id: 'inst-2', section_id: 'sec-2', draft_id: null, status: 'active', ai_rationale: null,
  instructor: { id: 'inst-2', full_name: 'Bob Roe', email: 'bob@example.com' },
  section: { id: 'sec-2', section_number: '01', status: 'filled', hours_required: 3, day_of_week: 'Tuesday', time_slot: '10:00 AM', course: { code: 'CS102', name: 'Data Structures' }, term: { name: 'Winter 2026' } }
}

function resolveAssignmentInsert(row: Row): Row {
  const instructor = INSTRUCTORS.find(i => i.id === row.instructor_id)
  const section = SECTIONS.find(s => s.id === row.section_id)
  return {
    ...row,
    instructor: instructor ? { id: instructor.id, full_name: instructor.full_name, email: instructor.email } : undefined,
    section: section ? { ...section, term: { name: 'Winter 2026' } } : undefined
  }
}

function mountSupabase(overrides: Partial<{ draft: Row; sections: Row[]; profiles: Row[]; assignments: Row[]; instructor_availability: Row[] }> = {}) {
  const tables: Record<string, ReturnType<typeof createTableMock>> = {
    drafts: createTableMock([overrides.draft ?? DRAFT]),
    sections: createTableMock(overrides.sections ?? SECTIONS),
    profiles: createTableMock(overrides.profiles ?? INSTRUCTORS),
    assignments: createTableMock(overrides.assignments ?? [LIVE_ASSIGNMENT], { resolveInsert: resolveAssignmentInsert }),
    instructor_availability: createTableMock(overrides.instructor_availability ?? [])
  }
  vi.mocked(supabase.from).mockImplementation(((table: string) => tables[table]) as never)
  return tables
}

function renderDraftDetail(draftId = 'draft-1') {
  return render(
    <MemoryRouter initialEntries={[`/admin/drafts/${draftId}`]}>
      <Routes>
        <Route path="/admin/drafts/:draftId" element={<AdminDraftDetail />} />
      </Routes>
    </MemoryRouter>
  )
}

describe('AdminDraftDetail', () => {
  beforeEach(() => {
    vi.mocked(useAuthStore).mockReturnValue({ user: ADMIN_USER } as never)
    vi.mocked(toast.error).mockReset()
    vi.mocked(toast.success).mockReset()
    vi.mocked(logAction).mockClear()
    vi.mocked(notifyInstructor).mockClear()
  })

  it('shows a not-found message for an unknown draft id', async () => {
    const emptyTable = createTableMock([])
    vi.mocked(supabase.from).mockImplementation(() => emptyTable as never)
    renderDraftDetail('does-not-exist')
    expect(await screen.findByText('Draft not found.')).toBeInTheDocument()
  })

  it('loads the draft and shows the sandbox banner for a manual draft', async () => {
    mountSupabase()
    renderDraftDetail()
    expect(await screen.findByText('Winter Draft')).toBeInTheDocument()
    expect(screen.getByText('Sandbox Mode')).toBeInTheDocument()
  })

  it('shows the AI-generated banner and rationale for an AI draft', async () => {
    mountSupabase({
      draft: { ...DRAFT, is_ai_generated: true },
      assignments: [LIVE_ASSIGNMENT, {
        id: 'da-1', hours_assigned: 3, instructor_id: 'inst-1', section_id: 'sec-1', draft_id: 'draft-1', status: 'active',
        ai_rationale: 'Jane is qualified and available.',
        instructor: { id: 'inst-1', full_name: 'Jane Doe', email: 'jane@example.com' },
        section: { id: 'sec-1', section_number: '01', status: 'unassigned', hours_required: 3, day_of_week: 'Monday', time_slot: '9:00 AM', course: { code: 'CS101', name: 'Intro to CS' }, term: { name: 'Winter 2026' } }
      }]
    })
    renderDraftDetail()
    expect(await screen.findByText('AI-Generated Sandbox')).toBeInTheDocument()
    expect(screen.getByText(/Jane is qualified and available\./)).toBeInTheDocument()
  })

  it('shows a published banner instead of the assign form for a published draft', async () => {
    mountSupabase({ draft: { ...DRAFT, status: 'published', published_at: '2026-01-05T00:00:00Z' } })
    renderDraftDetail()
    expect(await screen.findByText(/This draft was published/)).toBeInTheDocument()
    expect(screen.queryByText('Add Draft Assignment')).not.toBeInTheDocument()
  })

  it('requires both a section and an instructor to add a draft assignment', async () => {
    mountSupabase()
    const user = userEvent.setup()
    renderDraftDetail()
    await screen.findByText('Winter Draft')

    await user.click(screen.getByRole('button', { name: 'Add to Draft' }))

    expect(toast.error).toHaveBeenCalledWith('Please select both a section and an instructor')
  })

  it('blocks adding a conflicting assignment and disables submit', async () => {
    mountSupabase({ instructor_availability: [{ instructor_id: 'inst-2', day: 'Tuesday', time_slot: '10:00 AM' }] })
    const user = userEvent.setup()
    renderDraftDetail()
    await screen.findByText('Winter Draft')

    const [sectionSelect, instructorSelect] = document.querySelectorAll('select')
    await user.selectOptions(sectionSelect, 'sec-2')
    await user.selectOptions(instructorSelect, 'inst-2')

    expect(await screen.findByText(/Cannot assign — 1 conflict found/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add to Draft' })).toBeDisabled()
  })

  it('adds a clean draft assignment and refreshes', async () => {
    mountSupabase()
    const user = userEvent.setup()
    renderDraftDetail()
    await screen.findByText('Winter Draft')

    const [sectionSelect, instructorSelect] = document.querySelectorAll('select')
    await user.selectOptions(sectionSelect, 'sec-1')
    await user.selectOptions(instructorSelect, 'inst-1')
    await user.click(screen.getByRole('button', { name: 'Add to Draft' }))

    expect(await screen.findByText('Draft Assignments (1)')).toBeInTheDocument()
    expect(toast.success).toHaveBeenCalledWith('Added to draft!')
    expect(logAction).toHaveBeenCalledWith('admin-1', 'draft_assigned', 'assignment', undefined, {
      draft: 'Winter Draft', instructor: 'Jane Doe', section: 'CS101 01'
    })
  })

  it('removes a draft assignment', async () => {
    mountSupabase({
      assignments: [LIVE_ASSIGNMENT, {
        id: 'da-1', hours_assigned: 3, instructor_id: 'inst-1', section_id: 'sec-1', draft_id: 'draft-1', status: 'active', ai_rationale: null,
        instructor: { id: 'inst-1', full_name: 'Jane Doe', email: 'jane@example.com' },
        section: { id: 'sec-1', section_number: '01', status: 'unassigned', hours_required: 3, day_of_week: 'Monday', time_slot: '9:00 AM', course: { code: 'CS101', name: 'Intro to CS' }, term: { name: 'Winter 2026' } }
      }]
    })
    const user = userEvent.setup()
    renderDraftDetail()
    await screen.findByText('Draft Assignments (1)')

    await user.click(screen.getByRole('button', { name: 'Remove' }))

    expect(await screen.findByText('Draft Assignments (0)')).toBeInTheDocument()
    expect(toast.success).toHaveBeenCalledWith('Removed from draft!')
    expect(logAction).toHaveBeenCalledWith('admin-1', 'draft_unassigned', 'assignment', 'da-1', {
      draft: 'Winter Draft', instructor: 'Jane Doe', section: 'CS101 01'
    })
  })

  it('refuses to publish an empty draft', async () => {
    mountSupabase()
    const user = userEvent.setup()
    renderDraftDetail()
    await screen.findByText('Winter Draft')

    await user.click(screen.getByRole('button', { name: /Publish Draft/ }))

    expect(toast.error).toHaveBeenCalledWith('This draft has no assignments to publish')
    expect(screen.queryByText('Resolve Publish Conflicts')).not.toBeInTheDocument()
  })

  it('publishes directly with no conflicts, notifying the instructor and marking the draft published', async () => {
    mountSupabase({
      assignments: [{
        id: 'da-1', hours_assigned: 3, instructor_id: 'inst-1', section_id: 'sec-1', draft_id: 'draft-1', status: 'active', ai_rationale: null,
        instructor: { id: 'inst-1', full_name: 'Jane Doe', email: 'jane@example.com' },
        section: { id: 'sec-1', section_number: '01', status: 'unassigned', hours_required: 3, day_of_week: 'Monday', time_slot: '9:00 AM', course: { code: 'CS101', name: 'Intro to CS' }, term: { name: 'Winter 2026' } }
      }]
    })
    const user = userEvent.setup()
    renderDraftDetail()
    await screen.findByText('Draft Assignments (1)')

    await user.click(screen.getByRole('button', { name: /Publish Draft/ }))

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Draft published! 1 assignment(s) are now live.'))
    expect(notifyInstructor).toHaveBeenCalledWith('inst-1', 'notify_assigned', expect.stringContaining('CS101'))
    expect(logAction).toHaveBeenCalledWith('admin-1', 'published', 'draft', 'draft-1', expect.objectContaining({ autoConverted: 1 }))
    expect(await screen.findByText(/This draft was published/)).toBeInTheDocument()
  })

  it('shows the conflict-resolution modal when a draft assignment collides with a live one', async () => {
    mountSupabase({
      assignments: [LIVE_ASSIGNMENT, {
        id: 'da-1', hours_assigned: 3, instructor_id: 'inst-1', section_id: 'sec-2', draft_id: 'draft-1', status: 'active', ai_rationale: null,
        instructor: { id: 'inst-1', full_name: 'Jane Doe', email: 'jane@example.com' },
        section: { id: 'sec-2', section_number: '01', status: 'filled', hours_required: 3, day_of_week: 'Tuesday', time_slot: '10:00 AM', course: { code: 'CS102', name: 'Data Structures' }, term: { name: 'Winter 2026' } }
      }]
    })
    const user = userEvent.setup()
    renderDraftDetail()
    await screen.findByText('Draft Assignments (1)')

    await user.click(screen.getByRole('button', { name: /Publish Draft/ }))

    expect(await screen.findByText('Resolve Publish Conflicts')).toBeInTheDocument()
    const confirmButton = screen.getByRole('button', { name: 'Confirm Publish' })
    expect(confirmButton).toBeDisabled()

    await user.click(screen.getByRole('button', { name: /Use Draft/ }))
    expect(confirmButton).toBeEnabled()
  })

  it('"Use Draft" replaces the live assignment and notifies both instructors', async () => {
    const tables = mountSupabase({
      assignments: [LIVE_ASSIGNMENT, {
        id: 'da-1', hours_assigned: 3, instructor_id: 'inst-1', section_id: 'sec-2', draft_id: 'draft-1', status: 'active', ai_rationale: null,
        instructor: { id: 'inst-1', full_name: 'Jane Doe', email: 'jane@example.com' },
        section: { id: 'sec-2', section_number: '01', status: 'filled', hours_required: 3, day_of_week: 'Tuesday', time_slot: '10:00 AM', course: { code: 'CS102', name: 'Data Structures' }, term: { name: 'Winter 2026' } }
      }]
    })
    const user = userEvent.setup()
    renderDraftDetail()
    await screen.findByText('Draft Assignments (1)')
    await user.click(screen.getByRole('button', { name: /Publish Draft/ }))
    await screen.findByText('Resolve Publish Conflicts')

    await user.click(screen.getByRole('button', { name: /Use Draft/ }))
    await user.click(screen.getByRole('button', { name: 'Confirm Publish' }))

    await waitFor(() => expect(toast.success).toHaveBeenCalled())
    expect(tables.assignments.getRows().find(r => r.id === 'live-1')).toBeUndefined()
    expect(notifyInstructor).toHaveBeenCalledWith('inst-2', 'notify_unassigned', expect.stringContaining('CS102'))
    expect(notifyInstructor).toHaveBeenCalledWith('inst-1', 'notify_assigned', expect.stringContaining('CS102'))
  })

  it('"Keep Live" discards the draft assignment and leaves the live one untouched', async () => {
    const tables = mountSupabase({
      assignments: [LIVE_ASSIGNMENT, {
        id: 'da-1', hours_assigned: 3, instructor_id: 'inst-1', section_id: 'sec-2', draft_id: 'draft-1', status: 'active', ai_rationale: null,
        instructor: { id: 'inst-1', full_name: 'Jane Doe', email: 'jane@example.com' },
        section: { id: 'sec-2', section_number: '01', status: 'filled', hours_required: 3, day_of_week: 'Tuesday', time_slot: '10:00 AM', course: { code: 'CS102', name: 'Data Structures' }, term: { name: 'Winter 2026' } }
      }]
    })
    const user = userEvent.setup()
    renderDraftDetail()
    await screen.findByText('Draft Assignments (1)')
    await user.click(screen.getByRole('button', { name: /Publish Draft/ }))
    await screen.findByText('Resolve Publish Conflicts')

    await user.click(screen.getByRole('button', { name: /Keep Live/ }))
    await user.click(screen.getByRole('button', { name: 'Confirm Publish' }))

    await waitFor(() => expect(toast.success).toHaveBeenCalled())
    expect(tables.assignments.getRows().find(r => r.id === 'live-1')).toBeDefined()
    expect(tables.assignments.getRows().find(r => r.id === 'da-1')).toBeUndefined()
    expect(logAction).toHaveBeenCalledWith('admin-1', 'draft_discarded', 'assignment', 'da-1', expect.objectContaining({ resolution: 'kept_live' }))
  })
})
