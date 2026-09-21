import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import toast from 'react-hot-toast'
import AdminAssignments from './Assignments'
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

  function chain(op: 'select' | 'insert' | 'delete', payload?: Row) {
    const filters: { field: string; kind: 'eq' | 'neq'; value: unknown }[] = []
    const matches = (r: Row) => filters.every(f => f.kind === 'eq' ? r[f.field] === f.value : r[f.field] !== f.value)
    const builder = {
      select: () => builder,
      order: () => builder,
      eq: (field: string, value: unknown) => { filters.push({ field, kind: 'eq', value }); return builder },
      neq: (field: string, value: unknown) => { filters.push({ field, kind: 'neq', value }); return builder },
      is: (field: string, value: unknown) => { filters.push({ field, kind: 'eq', value }); return builder },
      then: (resolve: (v: { data?: Row[]; error: null }) => unknown) => {
        let result: { data?: Row[]; error: null }
        if (op === 'select') {
          result = { data: rows.filter(matches), error: null }
        } else if (op === 'insert') {
          const row = opts.resolveInsert ? opts.resolveInsert({ id: `new-${nextId++}`, ...payload }) : { id: `new-${nextId++}`, ...payload }
          rows.push(row)
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
    delete: () => chain('delete'),
    getRows: () => rows
  }
}

const SECTIONS: Row[] = [
  { id: 'sec-1', section_number: '01', hours_required: 3, status: 'unassigned', day_of_week: 'Monday', time_slot: '9:00 AM', course: { code: 'CS101', name: 'Intro to CS' }, term: { name: 'Winter 2026' } },
  { id: 'sec-2', section_number: '01', hours_required: 3, status: 'filled', day_of_week: 'Tuesday', time_slot: '10:00 AM', course: { code: 'CS102', name: 'Data Structures' }, term: { name: 'Winter 2026' } }
]
const INSTRUCTORS: Row[] = [
  { id: 'inst-1', full_name: 'Jane Doe', email: 'jane@example.com', role: 'instructor', instructor_profiles: { max_hours_per_term: 40 } },
  { id: 'inst-2', full_name: 'Bob Roe', email: 'bob@example.com', role: 'instructor', instructor_profiles: { max_hours_per_term: 40 } }
]
const LIVE_ASSIGNMENT: Row = {
  id: 'a1', hours_assigned: 3, instructor_id: 'inst-2', section_id: 'sec-2', draft_id: null, status: 'active',
  instructor: { id: 'inst-2', full_name: 'Bob Roe', email: 'bob@example.com' },
  section: { id: 'sec-2', section_number: '01', status: 'filled', hours_required: 3, day_of_week: 'Tuesday', time_slot: '10:00 AM', course: { code: 'CS102', name: 'Data Structures' }, term: { name: 'Winter 2026' } }
}

function resolveAssignmentInsert(row: Row): Row {
  const instructor = INSTRUCTORS.find(i => i.id === row.instructor_id)
  const section = SECTIONS.find(s => s.id === row.section_id)
  return {
    ...row,
    // Real Postgres defaults an unspecified nullable column to NULL, which the
    // .is('draft_id', null) refetch filter must match — mirror that here.
    draft_id: row.draft_id ?? null,
    instructor: instructor ? { id: instructor.id, full_name: instructor.full_name, email: instructor.email } : undefined,
    section: section ? { ...section } : undefined
  }
}

function mountSupabase(overrides: Partial<{ sections: Row[]; profiles: Row[]; assignments: Row[]; instructor_availability: Row[] }> = {}) {
  const tables: Record<string, ReturnType<typeof createTableMock>> = {
    sections: createTableMock(overrides.sections ?? SECTIONS),
    profiles: createTableMock(overrides.profiles ?? INSTRUCTORS),
    assignments: createTableMock(overrides.assignments ?? [LIVE_ASSIGNMENT], { resolveInsert: resolveAssignmentInsert }),
    instructor_availability: createTableMock(overrides.instructor_availability ?? [])
  }
  vi.mocked(supabase.from).mockImplementation(((table: string) => tables[table]) as never)
  return tables
}

describe('AdminAssignments', () => {
  beforeEach(() => {
    vi.mocked(useAuthStore).mockReturnValue({ user: ADMIN_USER } as never)
    vi.mocked(toast.error).mockReset()
    vi.mocked(toast.success).mockReset()
    vi.mocked(logAction).mockClear()
    vi.mocked(notifyInstructor).mockClear()
  })

  it('loads and lists current assignments', async () => {
    mountSupabase()
    render(<AdminAssignments />)
    expect(await screen.findByText('Current Assignments (1)')).toBeInTheDocument()
    expect(screen.getByText('Bob Roe')).toBeInTheDocument()
    expect(screen.getByText('CS102')).toBeInTheDocument()
  })

  it('requires both a section and an instructor', async () => {
    mountSupabase({ assignments: [] })
    const user = userEvent.setup()
    render(<AdminAssignments />)
    await screen.findByText('Current Assignments (0)')

    await user.click(screen.getByRole('button', { name: 'Assign Instructor' }))

    expect(toast.error).toHaveBeenCalledWith('Please select both a section and an instructor')
  })

  it('blocks assigning to an already-assigned section', async () => {
    mountSupabase()
    const user = userEvent.setup()
    render(<AdminAssignments />)
    await screen.findByText('Current Assignments (1)')

    const [sectionSelect, instructorSelect] = document.querySelectorAll('select')
    await user.selectOptions(sectionSelect, 'sec-2')
    await user.selectOptions(instructorSelect, 'inst-1')
    await user.click(screen.getByRole('button', { name: 'Assign Instructor' }))

    expect(toast.error).toHaveBeenCalledWith('This section already has an instructor assigned')
  })

  it('blocks and displays a scheduling conflict, disabling submit', async () => {
    mountSupabase({ instructor_availability: [{ instructor_id: 'inst-1', day: 'Monday', time_slot: '9:00 AM' }] })
    const user = userEvent.setup()
    render(<AdminAssignments />)
    await screen.findByText('Current Assignments (1)')

    const [sectionSelect, instructorSelect] = document.querySelectorAll('select')
    await user.selectOptions(sectionSelect, 'sec-1')
    await user.selectOptions(instructorSelect, 'inst-1')

    expect(await screen.findByText(/Cannot assign — 1 conflict found/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Assign Instructor' })).toBeDisabled()
  })

  it('assigns an instructor, logs it, notifies them, and refreshes', async () => {
    mountSupabase()
    const user = userEvent.setup()
    render(<AdminAssignments />)
    await screen.findByText('Current Assignments (1)')

    const [sectionSelect, instructorSelect] = document.querySelectorAll('select')
    await user.selectOptions(sectionSelect, 'sec-1')
    await user.selectOptions(instructorSelect, 'inst-1')
    await user.click(screen.getByRole('button', { name: 'Assign Instructor' }))

    expect(await screen.findByText('Current Assignments (2)')).toBeInTheDocument()
    expect(toast.success).toHaveBeenCalledWith('Instructor assigned!')
    expect(logAction).toHaveBeenCalledWith('admin-1', 'assigned', 'assignment', undefined, { instructor: 'Jane Doe', section: 'CS101 01' })
    expect(notifyInstructor).toHaveBeenCalledWith('inst-1', 'notify_assigned', expect.stringContaining('CS101'))
  })

  it('removes an assignment, notifies the instructor, and refreshes', async () => {
    mountSupabase()
    const user = userEvent.setup()
    render(<AdminAssignments />)
    await screen.findByText('Current Assignments (1)')

    await user.click(screen.getByRole('button', { name: 'Remove' }))

    await waitFor(() => expect(screen.getByText('Current Assignments (0)')).toBeInTheDocument())
    expect(toast.success).toHaveBeenCalledWith('Assignment removed!')
    expect(logAction).toHaveBeenCalledWith('admin-1', 'removed', 'assignment', 'a1')
    expect(notifyInstructor).toHaveBeenCalledWith('inst-2', 'notify_unassigned', expect.stringContaining('CS102'))
  })
})
