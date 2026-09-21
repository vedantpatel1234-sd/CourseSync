import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import toast from 'react-hot-toast'
import InstructorQualifications from './Qualifications'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../stores/authStore'

vi.mock('../../lib/supabase', () => ({ supabase: { from: vi.fn() } }))
vi.mock('../../stores/authStore', () => ({ useAuthStore: vi.fn() }))
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }))

const INSTRUCTOR_USER = { id: 'inst-1', full_name: 'Jane Doe', email: 'jane@example.com', role: 'instructor' as const }

type Row = Record<string, unknown>

function createTableMock(initialRows: Row[]) {
  let rows = [...initialRows]
  let nextId = 100

  function chain(op: 'select' | 'insert' | 'delete', payload?: Row) {
    const filters: { field: string; value: unknown }[] = []
    const builder = {
      select: () => builder,
      order: () => builder,
      eq: (field: string, value: unknown) => { filters.push({ field, value }); return builder },
      then: (resolve: (v: { data?: Row[]; error: null }) => unknown) => {
        let result: { data?: Row[]; error: null }
        if (op === 'select') {
          result = { data: rows.filter(r => filters.every(f => r[f.field] === f.value)), error: null }
        } else if (op === 'insert') {
          rows.push({ id: `qual-${nextId++}`, ...payload })
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

  return { select: () => chain('select'), insert: (p: Row) => chain('insert', p), delete: () => chain('delete'), getRows: () => rows }
}

const COURSES: Row[] = [
  { id: 'course-1', code: 'CS101', name: 'Intro to CS' },
  { id: 'course-2', code: 'CS201', name: 'Data Structures' }
]

function mountSupabase(overrides: Partial<{ courses: Row[]; qualifications: Row[] }> = {}) {
  const tables: Record<string, ReturnType<typeof createTableMock>> = {
    courses: createTableMock(overrides.courses ?? COURSES),
    qualifications: createTableMock(overrides.qualifications ?? [])
  }
  vi.mocked(supabase.from).mockImplementation(((table: string) => tables[table]) as never)
  return tables
}

describe('InstructorQualifications', () => {
  beforeEach(() => {
    vi.mocked(useAuthStore).mockReturnValue({ user: INSTRUCTOR_USER } as never)
    vi.mocked(toast.success).mockReset()
  })

  it('lists courses and computes total/verified/pending stat cards', async () => {
    mountSupabase({
      qualifications: [
        { id: 'q1', instructor_id: 'inst-1', course_id: 'course-1', verified: true },
        { id: 'q2', instructor_id: 'inst-1', course_id: 'course-2', verified: false }
      ]
    })
    render(<InstructorQualifications />)

    const cs101 = (await screen.findByText('CS101')).closest('div')!.parentElement!
    expect(within(cs101).getByText('✓ Verified')).toBeInTheDocument()
    const cs201 = screen.getByText('CS201').closest('div')!.parentElement!
    expect(within(cs201).getByText('⏳ Pending')).toBeInTheDocument()
  })

  it('adds a qualification as unverified and refreshes', async () => {
    const tables = mountSupabase()
    const user = userEvent.setup()
    render(<InstructorQualifications />)
    const cs101Card = (await screen.findByText('CS101')).closest('div')!.parentElement!

    await user.click(within(cs101Card).getByRole('button', { name: 'Add' }))

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Qualification added — pending verification'))
    expect(tables.qualifications.getRows()).toContainEqual(expect.objectContaining({ instructor_id: 'inst-1', course_id: 'course-1', verified: false }))
    expect(await screen.findByText('⏳ Pending')).toBeInTheDocument()
  })

  it('removes a qualification', async () => {
    mountSupabase({ qualifications: [{ id: 'q1', instructor_id: 'inst-1', course_id: 'course-1', verified: false }] })
    const user = userEvent.setup()
    render(<InstructorQualifications />)
    const cs101Card = (await screen.findByText('CS101')).closest('div')!.parentElement!
    await within(cs101Card).findByText('⏳ Pending')

    await user.click(within(cs101Card).getByRole('button', { name: 'Remove' }))

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Qualification removed'))
    expect(screen.queryByText('⏳ Pending')).not.toBeInTheDocument()
  })
})
