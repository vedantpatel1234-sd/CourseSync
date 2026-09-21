import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import toast from 'react-hot-toast'
import AdminInstructors from './Instructors'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../stores/authStore'
import { logAction } from '../../lib/audit'
import { notifyInstructor } from '../../lib/notifications'
import { parseResume } from '../../lib/resumeParser'

vi.mock('../../lib/supabase', () => ({
  supabase: { from: vi.fn(), functions: { invoke: vi.fn() } }
}))
vi.mock('../../stores/authStore', () => ({ useAuthStore: vi.fn() }))
vi.mock('../../lib/audit', () => ({ logAction: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../../lib/notifications', () => ({ notifyInstructor: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../../lib/resumeParser', () => ({ parseResume: vi.fn() }))
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }))

const ADMIN_USER = { id: 'admin-1', full_name: 'Admin', email: 'admin@example.com', role: 'admin' as const }

type Row = Record<string, unknown>

function createTableMock(initialRows: Row[]) {
  let rows = [...initialRows]

  function chain(op: 'select' | 'insert' | 'update', payload?: Row | Row[]) {
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
          const items = Array.isArray(payload) ? payload : [payload as Row]
          items.forEach((item, i) => rows.push({ id: `new-${rows.length + i}`, ...item }))
          result = { error: null }
        } else {
          rows = rows.map(r => matches(r) ? { ...r, ...payload } : r)
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
    remove: (id: string) => { rows = rows.filter(r => r.id !== id) },
    getRows: () => rows
  }
}

const INSTRUCTORS: Row[] = [
  { id: 'inst-1', full_name: 'Jane Doe', email: 'jane@example.com', role: 'instructor', instructor_profiles: { max_hours_per_term: 40, department: 'CS', title: 'Lecturer' } }
]
const ASSIGNMENTS: Row[] = [{ instructor_id: 'inst-1', hours_assigned: 10, draft_id: null, status: 'active' }]
const QUALIFICATIONS: Row[] = [
  { id: 'qual-1', instructor_id: 'inst-1', course_id: 'course-1', verified: false, course: { code: 'CS101', name: 'Intro to CS' } }
]

function mountSupabase(overrides: Partial<{ profiles: Row[]; assignments: Row[]; qualifications: Row[] }> = {}) {
  const tables: Record<string, ReturnType<typeof createTableMock>> = {
    profiles: createTableMock(overrides.profiles ?? INSTRUCTORS),
    assignments: createTableMock(overrides.assignments ?? ASSIGNMENTS),
    qualifications: createTableMock(overrides.qualifications ?? QUALIFICATIONS)
  }
  vi.mocked(supabase.from).mockImplementation(((table: string) => tables[table]) as never)
  return tables
}

function fillValidNewInstructorForm(user: ReturnType<typeof userEvent.setup>) {
  return (async () => {
    await user.type(screen.getByPlaceholderText('Dr. Jane Smith'), 'New Person')
    await user.type(screen.getByPlaceholderText('jane@university.ca'), 'new@example.com')
    await user.type(screen.getByPlaceholderText('Min 8 chars, 1 uppercase, 1 number'), 'Password1')
    await user.type(screen.getByPlaceholderText('Computer Science'), 'Math')
    await user.type(screen.getByPlaceholderText('Associate Professor'), 'Professor')
  })()
}

describe('AdminInstructors', () => {
  beforeEach(() => {
    vi.mocked(useAuthStore).mockReturnValue({ user: ADMIN_USER } as never)
    vi.mocked(supabase.functions.invoke).mockReset()
    vi.mocked(toast.error).mockReset()
    vi.mocked(toast.success).mockReset()
    vi.mocked(logAction).mockClear()
    vi.mocked(notifyInstructor).mockClear()
  })

  it('loads and lists instructors with their workload', async () => {
    mountSupabase()
    render(<AdminInstructors />)
    expect(await screen.findByText('Jane Doe')).toBeInTheDocument()
    expect(screen.getByText('jane@example.com')).toBeInTheDocument()
    expect(screen.getByText('10/40h')).toBeInTheDocument()
    expect(screen.getByText('Qualifications (1)')).toBeInTheDocument()
  })

  it('expands to show qualifications and verifies one', async () => {
    mountSupabase()
    const user = userEvent.setup()
    render(<AdminInstructors />)
    await screen.findByText('Jane Doe')

    await user.click(screen.getByText('Qualifications (1)'))
    expect(screen.getByText('CS101')).toBeInTheDocument()
    const verifyButton = screen.getByRole('button', { name: 'Verify' })
    await user.click(verifyButton)

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Qualification verified!'))
    expect(logAction).toHaveBeenCalledWith('admin-1', 'verified', 'qualification', 'qual-1', { instructor: 'Jane Doe', course: 'CS101' })
    expect(notifyInstructor).toHaveBeenCalledWith('inst-1', 'notify_qualification_verified', expect.stringContaining('CS101'))
  })

  it('does not notify when un-verifying an already-verified qualification', async () => {
    mountSupabase({ qualifications: [{ id: 'qual-1', instructor_id: 'inst-1', course_id: 'course-1', verified: true, course: { code: 'CS101', name: 'Intro to CS' } }] })
    const user = userEvent.setup()
    render(<AdminInstructors />)
    await screen.findByText('Jane Doe')

    await user.click(screen.getByText('Qualifications (1)'))
    await user.click(screen.getByRole('button', { name: '✓ Verified' }))

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Qualification unverified'))
    expect(notifyInstructor).not.toHaveBeenCalled()
  })

  it('validates the new-instructor form', async () => {
    mountSupabase()
    const user = userEvent.setup()
    render(<AdminInstructors />)
    await screen.findByText('Jane Doe')

    await user.click(screen.getByRole('button', { name: 'Add Instructor' }))

    expect(await screen.findByText('Name must be at least 2 characters')).toBeInTheDocument()
    expect(screen.getByText('Valid email is required')).toBeInTheDocument()
    expect(screen.getByText(/Password must/)).toBeInTheDocument()
    expect(screen.getByText('Department is required')).toBeInTheDocument()
    expect(screen.getByText('Title is required')).toBeInTheDocument()
    expect(supabase.functions.invoke).not.toHaveBeenCalled()
  })

  it('rejects a password missing an uppercase letter or a number', async () => {
    mountSupabase()
    const user = userEvent.setup()
    render(<AdminInstructors />)
    await screen.findByText('Jane Doe')

    await user.type(screen.getByPlaceholderText('Dr. Jane Smith'), 'New Person')
    await user.type(screen.getByPlaceholderText('jane@university.ca'), 'new@example.com')
    await user.type(screen.getByPlaceholderText('Min 8 chars, 1 uppercase, 1 number'), 'lowercase')
    await user.type(screen.getByPlaceholderText('Computer Science'), 'Math')
    await user.type(screen.getByPlaceholderText('Associate Professor'), 'Professor')
    await user.click(screen.getByRole('button', { name: 'Add Instructor' }))

    expect(await screen.findByText(/Password must contain/)).toBeInTheDocument()
  })

  it('creates an instructor via the manage-instructor function and refreshes the list', async () => {
    vi.mocked(supabase.functions.invoke).mockResolvedValue({ data: { id: 'inst-2', success: true }, error: null } as never)
    mountSupabase()
    const user = userEvent.setup()
    render(<AdminInstructors />)
    await screen.findByText('Jane Doe')

    await fillValidNewInstructorForm(user)
    await user.click(screen.getByRole('button', { name: 'Add Instructor' }))

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Instructor added!'))
    expect(supabase.functions.invoke).toHaveBeenCalledWith('manage-instructor', {
      body: { action: 'create', full_name: 'New Person', email: 'new@example.com', password: 'Password1', department: 'Math', title: 'Professor', max_hours_per_term: 40 }
    })
    expect(logAction).toHaveBeenCalledWith('admin-1', 'created', 'instructor', 'inst-2', { name: 'New Person', email: 'new@example.com' })
  })

  it('shows an error toast and does not reset the form when creation fails', async () => {
    vi.mocked(supabase.functions.invoke).mockResolvedValue({ data: { error: 'Email already in use' }, error: null } as never)
    mountSupabase()
    const user = userEvent.setup()
    render(<AdminInstructors />)
    await screen.findByText('Jane Doe')

    await fillValidNewInstructorForm(user)
    await user.click(screen.getByRole('button', { name: 'Add Instructor' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Email already in use'))
    expect(logAction).not.toHaveBeenCalled()
    expect((screen.getByPlaceholderText('Dr. Jane Smith') as HTMLInputElement).value).toBe('New Person')
  })

  it('deletes an instructor via the manage-instructor function', async () => {
    const tables = mountSupabase()
    vi.mocked(supabase.functions.invoke).mockImplementation((async (_name: string, opts: { body: { instructor_id: string } }) => {
      tables.profiles.remove(opts.body.instructor_id)
      return { data: { success: true }, error: null }
    }) as never)
    const user = userEvent.setup()
    render(<AdminInstructors />)
    await screen.findByText('Jane Doe')

    await user.click(screen.getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(screen.queryByText('Jane Doe')).not.toBeInTheDocument())
    expect(supabase.functions.invoke).toHaveBeenCalledWith('manage-instructor', { body: { action: 'delete', instructor_id: 'inst-1' } })
    expect(toast.success).toHaveBeenCalledWith('Instructor deleted!')
    expect(logAction).toHaveBeenCalledWith('admin-1', 'deleted', 'instructor', 'inst-1', { name: 'Jane Doe' })
  })

  it('parses an uploaded resume and pre-fills empty fields, leaving already-typed ones alone', async () => {
    vi.mocked(parseResume).mockResolvedValue({
      fullName: 'Parsed Name', email: 'parsed@example.com', department: 'Physics', title: 'Assistant Professor',
      maxHoursPerTerm: 25,
      qualificationSuggestions: [{ courseId: 'course-1', code: 'CS101', name: 'Intro to CS', reason: 'Taught it for years' }]
    })
    mountSupabase()
    const user = userEvent.setup()
    render(<AdminInstructors />)
    await screen.findByText('Jane Doe')

    // Pre-type the name so we can verify the parser doesn't clobber a field the admin already filled in.
    await user.type(screen.getByPlaceholderText('Dr. Jane Smith'), 'Manually Typed')

    const file = new File(['%PDF-1.4'], 'resume.pdf', { type: 'application/pdf' })
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    await user.upload(fileInput, file)

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Resume parsed — review the pre-filled fields below.'))
    expect((screen.getByPlaceholderText('Dr. Jane Smith') as HTMLInputElement).value).toBe('Manually Typed')
    expect((screen.getByPlaceholderText('jane@university.ca') as HTMLInputElement).value).toBe('parsed@example.com')
    expect(screen.getByText('CS101')).toBeInTheDocument()
    expect(screen.getByText(/Taught it for years/)).toBeInTheDocument()
  })

  it('shows an error toast when resume parsing fails', async () => {
    vi.mocked(parseResume).mockRejectedValue(new Error('File is too large — please upload a PDF under 4MB.'))
    mountSupabase()
    const user = userEvent.setup()
    render(<AdminInstructors />)
    await screen.findByText('Jane Doe')

    const file = new File(['%PDF-1.4'], 'resume.pdf', { type: 'application/pdf' })
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    await user.upload(fileInput, file)

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Could not parse resume: File is too large — please upload a PDF under 4MB.'))
  })

  it('only submits checked suggested qualifications as unverified rows', async () => {
    vi.mocked(parseResume).mockResolvedValue({
      fullName: '', email: '', department: '', title: '', maxHoursPerTerm: 40,
      qualificationSuggestions: [
        { courseId: 'course-1', code: 'CS101', name: 'Intro to CS', reason: 'A' },
        { courseId: 'course-2', code: 'CS201', name: 'Data Structures', reason: 'B' }
      ]
    })
    vi.mocked(supabase.functions.invoke).mockResolvedValue({ data: { id: 'inst-2', success: true }, error: null } as never)
    const tables = mountSupabase()
    const qualInsertSpy = vi.spyOn(tables.qualifications, 'insert')
    const user = userEvent.setup()
    render(<AdminInstructors />)
    await screen.findByText('Jane Doe')

    const file = new File(['%PDF-1.4'], 'resume.pdf', { type: 'application/pdf' })
    await user.upload(document.querySelector('input[type="file"]') as HTMLInputElement, file)
    await screen.findByText('CS201')

    // Uncheck the second suggestion before creating the instructor.
    const checkboxes = screen.getAllByRole('checkbox')
    await user.click(checkboxes[1])

    await fillValidNewInstructorForm(user)
    await user.click(screen.getByRole('button', { name: 'Add Instructor' }))

    await waitFor(() => expect(qualInsertSpy).toHaveBeenCalledWith([
      { instructor_id: 'inst-2', course_id: 'course-1', verified: false }
    ]))
  })
})
