import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import toast from 'react-hot-toast'
import AdminCourses from './Courses'
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

interface Course { id: string; code: string; name: string; description: string }

function createCoursesTableMock(initialRows: Course[]) {
  let rows = [...initialRows]
  let nextId = 100
  let forceDeleteErrorFor: string | null = null

  function chain(op: 'select' | 'insert' | 'delete', payload?: Partial<Course>) {
    const filters: { field: string; value: unknown }[] = []
    const builder = {
      select: () => builder,
      order: () => builder,
      eq: (field: string, value: unknown) => { filters.push({ field, value }); return builder },
      then: (resolve: (v: { data?: Course[]; error: { code?: string; message: string } | null }) => unknown) => {
        let result: { data?: Course[]; error: { code?: string; message: string } | null }
        if (op === 'select') {
          result = { data: rows, error: null }
        } else if (op === 'insert') {
          rows.push({ id: `course-${nextId++}`, code: '', name: '', description: '', ...payload } as Course)
          result = { error: null }
        } else {
          const target = rows.find(r => filters.every(f => (r as unknown as Record<string, unknown>)[f.field] === f.value))
          if (target && target.id === forceDeleteErrorFor) {
            result = { error: { code: '23503', message: 'FK violation' } }
          } else {
            rows = rows.filter(r => r.id !== target?.id)
            result = { error: null }
          }
        }
        return Promise.resolve(result).then(resolve)
      }
    }
    return builder
  }

  return {
    select: () => chain('select'),
    insert: (payload: Partial<Course>) => chain('insert', payload),
    delete: () => chain('delete'),
    blockDeleteFor: (id: string) => { forceDeleteErrorFor = id }
  }
}

function mountSupabase(initialRows: Course[]) {
  const table = createCoursesTableMock(initialRows)
  vi.mocked(supabase.from).mockImplementation(() => table as never)
  return table
}

const SAMPLE_COURSES: Course[] = [
  { id: 'course-1', code: 'CS101', name: 'Intro to CS', description: 'Fundamentals' },
  { id: 'course-2', code: 'CS201', name: 'Data Structures', description: '' }
]

describe('AdminCourses', () => {
  beforeEach(() => {
    vi.mocked(useAuthStore).mockReturnValue({ user: ADMIN_USER } as never)
    vi.mocked(toast.error).mockReset()
    vi.mocked(toast.success).mockReset()
    vi.mocked(logAction).mockClear()
  })

  it('loads and lists existing courses', async () => {
    mountSupabase(SAMPLE_COURSES)
    render(<AdminCourses />)
    expect(await screen.findByText('CS101')).toBeInTheDocument()
    expect(screen.getByText('Data Structures')).toBeInTheDocument()
    expect(screen.getByText('—')).toBeInTheDocument() // empty description placeholder
  })

  it('validates the code and name before calling supabase', async () => {
    const table = mountSupabase([])
    const insertSpy = vi.spyOn(table, 'insert')
    const user = userEvent.setup()
    render(<AdminCourses />)
    await screen.findByRole('button', { name: 'Add Course' })

    await user.click(screen.getByRole('button', { name: 'Add Course' }))

    expect(await screen.findByText('Code is required')).toBeInTheDocument()
    expect(screen.getByText('Name is required')).toBeInTheDocument()
    expect(insertSpy).not.toHaveBeenCalled()
  })

  it('rejects a code with non-alphanumeric characters', async () => {
    mountSupabase([])
    const user = userEvent.setup()
    render(<AdminCourses />)

    await user.type(screen.getByPlaceholderText('COMP1234'), 'CS-101')
    await user.type(screen.getByPlaceholderText('Introduction to Programming'), 'Intro to CS')
    await user.click(screen.getByRole('button', { name: 'Add Course' }))

    expect(await screen.findByText('Letters and numbers only')).toBeInTheDocument()
  })

  it('rejects a name shorter than 3 characters', async () => {
    mountSupabase([])
    const user = userEvent.setup()
    render(<AdminCourses />)

    await user.type(screen.getByPlaceholderText('COMP1234'), 'CS101')
    await user.type(screen.getByPlaceholderText('Introduction to Programming'), 'CS')
    await user.click(screen.getByRole('button', { name: 'Add Course' }))

    expect(await screen.findByText('Name must be at least 3 characters')).toBeInTheDocument()
  })

  it('adds a course, logs it, and refreshes the list', async () => {
    mountSupabase([])
    const user = userEvent.setup()
    render(<AdminCourses />)

    await user.type(screen.getByPlaceholderText('COMP1234'), 'CS101')
    await user.type(screen.getByPlaceholderText('Introduction to Programming'), 'Intro to CS')
    await user.click(screen.getByRole('button', { name: 'Add Course' }))

    expect(await screen.findByText('CS101')).toBeInTheDocument()
    expect(toast.success).toHaveBeenCalledWith('Course added!')
    expect(logAction).toHaveBeenCalledWith('admin-1', 'created', 'course', undefined, { code: 'CS101', name: 'Intro to CS' })
  })

  it('deletes a course', async () => {
    mountSupabase(SAMPLE_COURSES)
    const user = userEvent.setup()
    render(<AdminCourses />)
    await screen.findByText('CS201')

    const row = screen.getByText('Data Structures').closest('tr')!
    await user.click(within(row).getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(screen.queryByText('Data Structures')).not.toBeInTheDocument())
    expect(toast.success).toHaveBeenCalledWith('Course deleted!')
    expect(logAction).toHaveBeenCalledWith('admin-1', 'deleted', 'course', 'course-2', { code: 'CS201' })
  })

  it('shows a friendly message when delete is blocked by a foreign key', async () => {
    const table = mountSupabase(SAMPLE_COURSES)
    table.blockDeleteFor('course-2')
    const user = userEvent.setup()
    render(<AdminCourses />)
    await screen.findByText('CS201')

    const row = screen.getByText('Data Structures').closest('tr')!
    await user.click(within(row).getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(
      "Can't delete CS201 — it still has sections. Delete or reassign those sections first."
    ))
    expect(screen.getByText('Data Structures')).toBeInTheDocument()
  })
})
