import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import toast from 'react-hot-toast'
import AdminSections from './Sections'
import { supabase } from '../../lib/supabase'

vi.mock('../../lib/supabase', () => ({
  supabase: { from: vi.fn() }
}))
vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn() }
}))

type Row = Record<string, unknown>

function createTableMock(initialRows: Row[], opts: { resolveInsert?: (row: Row) => Row } = {}) {
  let rows = [...initialRows]
  let nextId = 100

  function chain(op: 'select' | 'insert' | 'update' | 'delete', payload?: Row) {
    const filters: { field: string; value: unknown }[] = []
    const builder = {
      select: () => builder,
      order: () => builder,
      eq: (field: string, value: unknown) => { filters.push({ field, value }); return builder },
      then: (resolve: (v: { data?: Row[]; error: null }) => unknown) => {
        let result: { data?: Row[]; error: null }
        if (op === 'select') {
          result = { data: rows, error: null }
        } else if (op === 'insert') {
          const newRow = { id: `row-${nextId++}`, ...payload }
          rows.push(opts.resolveInsert ? opts.resolveInsert(newRow) : newRow)
          result = { error: null }
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
    insert: (payload: Row) => chain('insert', payload),
    update: (payload: Row) => chain('update', payload),
    delete: () => chain('delete'),
    getRows: () => rows
  }
}

const COURSES: Row[] = [{ id: 'course-1', code: 'CS101', name: 'Intro to CS' }]
const TERMS: Row[] = [{ id: 'term-1', name: 'Winter 2026' }]
const SECTIONS: Row[] = [
  { id: 'sec-1', section_number: '01', hours_required: 3, status: 'unassigned', day_of_week: 'Monday', time_slot: '9:00 AM', course: { code: 'CS101', name: 'Intro to CS' }, term: { name: 'Winter 2026' } }
]

function mountSupabase(overrides: Partial<{ sections: Row[]; courses: Row[]; terms: Row[] }> = {}) {
  const courseList = overrides.courses ?? COURSES
  const termList = overrides.terms ?? TERMS

  const tables: Record<string, ReturnType<typeof createTableMock>> = {
    sections: createTableMock(overrides.sections ?? SECTIONS, {
      // Real supabase resolves the course:courses(...)/term:terms(...) embeds automatically —
      // simulate that so a freshly inserted row renders the same as a fetched one.
      resolveInsert: (row) => {
        const course = courseList.find(c => c.id === row.course_id)
        const term = termList.find(t => t.id === row.term_id)
        return { ...row, course: course ? { code: course.code, name: course.name } : undefined, term: term ? { name: term.name } : undefined }
      }
    }),
    courses: createTableMock(courseList),
    terms: createTableMock(termList)
  }
  vi.mocked(supabase.from).mockImplementation(((table: string) => tables[table]) as never)
  return tables
}

describe('AdminSections', () => {
  beforeEach(() => {
    vi.mocked(toast.error).mockReset()
    vi.mocked(toast.success).mockReset()
  })

  it('loads and lists existing sections', async () => {
    mountSupabase()
    render(<AdminSections />)
    const row = (await screen.findByText('CS101')).closest('tr')!
    expect(within(row).getByText('Section 01')).toBeInTheDocument()
    expect(within(row).getByText('Winter 2026')).toBeInTheDocument()
    expect(within(row).getByText('3h')).toBeInTheDocument()
    expect(within(row).getByText('Monday 9:00 AM')).toBeInTheDocument()
  })

  it('validates all required fields before calling supabase', async () => {
    const tables = mountSupabase({ sections: [] })
    const insertSpy = vi.spyOn(tables.sections, 'insert')
    const user = userEvent.setup()
    render(<AdminSections />)
    await screen.findByRole('button', { name: 'Add Section' })

    await user.click(screen.getByRole('button', { name: 'Add Section' }))

    expect(await screen.findByText('Please select a course')).toBeInTheDocument()
    expect(screen.getByText('Please select a term')).toBeInTheDocument()
    expect(screen.getByText('Section number is required')).toBeInTheDocument()
    expect(screen.getByText('Please select a day')).toBeInTheDocument()
    expect(screen.getByText('Please select a time')).toBeInTheDocument()
    expect(insertSpy).not.toHaveBeenCalled()
  })

  it('rejects hours outside the 1-20 range', async () => {
    mountSupabase({ sections: [] })
    const user = userEvent.setup()
    const { container } = render(<AdminSections />)
    await screen.findByRole('button', { name: 'Add Section' })

    const hoursInput = document.querySelector('input[type="number"]') as HTMLInputElement
    await user.clear(hoursInput)
    await user.type(hoursInput, '25')
    // Clicking the submit button would hit jsdom's native HTML5 constraint validation
    // (max=20) first, which blocks the submit event before React's onSubmit ever runs —
    // dispatch the submit event directly to exercise the app's own JS-level validation.
    fireEvent.submit(container.querySelector('form')!)

    expect(await screen.findByText('Hours must be between 1 and 20')).toBeInTheDocument()
  })

  it('adds a section with status unassigned and refreshes the list', async () => {
    mountSupabase({ sections: [] })
    const user = userEvent.setup()
    render(<AdminSections />)
    await screen.findByText('Select course...')

    const [courseSelect, termSelect, daySelect, timeSelect] = document.querySelectorAll('select')
    await user.selectOptions(courseSelect, 'course-1')
    await user.selectOptions(termSelect, 'term-1')
    await user.type(screen.getByPlaceholderText('01'), '02')
    await user.selectOptions(daySelect, 'Tuesday')
    await user.selectOptions(timeSelect, '10:00 AM')
    await user.click(screen.getByRole('button', { name: 'Add Section' }))

    expect(await screen.findByText('Section 02')).toBeInTheDocument()
    expect(toast.success).toHaveBeenCalledWith('Section added!')
  })

  it('edits a section\'s day/time in place', async () => {
    mountSupabase()
    const user = userEvent.setup()
    render(<AdminSections />)
    const row = (await screen.findByText('CS101')).closest('tr')!

    await user.click(within(row).getByRole('button', { name: 'Edit' }))
    const daySelect = within(row).getAllByRole('combobox')[0]
    const timeSelect = within(row).getAllByRole('combobox')[1]
    await user.selectOptions(daySelect, 'Wednesday')
    await user.selectOptions(timeSelect, '1:00 PM')
    await user.click(within(row).getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('Wednesday 1:00 PM')).toBeInTheDocument()
    expect(toast.success).toHaveBeenCalledWith('Schedule updated!')
  })

  it('rejects saving an edit with a missing day or time', async () => {
    const unscheduled: Row[] = [
      { id: 'sec-2', section_number: '02', hours_required: 3, status: 'unassigned', day_of_week: null, time_slot: null, course: { code: 'CS101', name: 'Intro to CS' }, term: { name: 'Winter 2026' } }
    ]
    const tables = mountSupabase({ sections: unscheduled })
    const updateSpy = vi.spyOn(tables.sections, 'update')
    const user = userEvent.setup()
    render(<AdminSections />)
    const row = (await screen.findByText('CS101')).closest('tr')!

    await user.click(within(row).getByRole('button', { name: 'Edit' }))
    await user.click(within(row).getByRole('button', { name: 'Save' }))

    expect(toast.error).toHaveBeenCalledWith('Please select both a day and a time')
    expect(updateSpy).not.toHaveBeenCalled()
  })

  it('cancels an edit without saving', async () => {
    mountSupabase()
    const user = userEvent.setup()
    render(<AdminSections />)
    const row = (await screen.findByText('CS101')).closest('tr')!

    await user.click(within(row).getByRole('button', { name: 'Edit' }))
    await user.click(within(row).getByRole('button', { name: 'Cancel' }))

    expect(screen.getByText('Monday 9:00 AM')).toBeInTheDocument()
  })

  it('deletes a section', async () => {
    mountSupabase()
    const user = userEvent.setup()
    render(<AdminSections />)
    const row = (await screen.findByText('CS101')).closest('tr')!

    await user.click(within(row).getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(screen.queryByText('CS101')).not.toBeInTheDocument())
    expect(toast.success).toHaveBeenCalledWith('Section deleted!')
  })
})
