import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import toast from 'react-hot-toast'
import InstructorAvailability from './Availability'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../stores/authStore'

vi.mock('../../lib/supabase', () => ({ supabase: { from: vi.fn() } }))
vi.mock('../../stores/authStore', () => ({ useAuthStore: vi.fn() }))
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }))

const INSTRUCTOR_USER = { id: 'inst-1', full_name: 'Jane Doe', email: 'jane@example.com', role: 'instructor' as const }

function chainable(data: unknown) {
  const chain: PromiseLike<{ data: unknown; error: null }> & Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    is: () => chain,
    neq: () => chain,
    then: (resolve: (v: { data: unknown; error: null }) => unknown) => Promise.resolve({ data, error: null }).then(resolve)
  } as never
  return chain
}

function mountSupabase(overrides: Partial<{ instructor_availability: unknown[]; assignments: unknown[] }> = {}) {
  const insertSpy = vi.fn().mockResolvedValue({ error: null })
  const deleteSpy = vi.fn().mockReturnValue(chainable(null))
  const tables: Record<string, unknown> = {
    instructor_availability: {
      select: () => chainable(overrides.instructor_availability ?? []),
      delete: deleteSpy,
      insert: insertSpy
    },
    assignments: chainable(overrides.assignments ?? [])
  }
  vi.mocked(supabase.from).mockImplementation(((table: string) => tables[table]) as never)
  return { insertSpy, deleteSpy }
}

// The legend row always shows the static labels "Available"/"Unavailable" as plain
// spans, so slot state must be asserted via the grid's buttons specifically, not
// screen.getByText, which would also match the legend.
function slotButtons(name: 'Available' | 'Unavailable') {
  return screen.queryAllByRole('button', { name }).filter(b => b.closest('table'))
}

describe('InstructorAvailability', () => {
  beforeEach(() => {
    vi.mocked(useAuthStore).mockReturnValue({ user: INSTRUCTOR_USER } as never)
    vi.mocked(toast.success).mockReset()
  })

  it('marks saved unavailable slots and disables slots where the instructor is actually teaching', async () => {
    mountSupabase({
      instructor_availability: [{ instructor_id: 'inst-1', day: 'Monday', time_slot: '9:00 AM' }],
      assignments: [{ section: { day_of_week: 'Tuesday', time_slot: '10:00 AM', section_number: '01', course: { code: 'CS101' } } }]
    })
    render(<InstructorAvailability />)

    await waitFor(() => expect(slotButtons('Unavailable')).toHaveLength(1))
    const teachingButton = screen.getByTitle('Teaching CS101 — Section 01')
    expect(teachingButton).toBeDisabled()
  })

  it('toggles a slot between Available and Unavailable', async () => {
    mountSupabase()
    const user = userEvent.setup()
    render(<InstructorAvailability />)
    await waitFor(() => expect(slotButtons('Available').length).toBeGreaterThan(0))

    await user.click(slotButtons('Available')[0])
    await waitFor(() => expect(slotButtons('Unavailable')).toHaveLength(1))

    await user.click(slotButtons('Unavailable')[0])
    await waitFor(() => expect(slotButtons('Unavailable')).toHaveLength(0))
  })

  it('cannot toggle a slot where the instructor is teaching', async () => {
    mountSupabase({
      assignments: [{ section: { day_of_week: 'Monday', time_slot: '8:00 AM', section_number: '01', course: { code: 'CS101' } } }]
    })
    const user = userEvent.setup()
    render(<InstructorAvailability />)
    const teachingButton = await screen.findByTitle('Teaching CS101 — Section 01')

    await user.click(teachingButton)

    expect(screen.getByTitle('Teaching CS101 — Section 01')).toBeInTheDocument()
    expect(slotButtons('Unavailable')).toHaveLength(0)
  })

  it('saves the unavailable set, deleting old rows first', async () => {
    const { insertSpy, deleteSpy } = mountSupabase({
      instructor_availability: [{ instructor_id: 'inst-1', day: 'Monday', time_slot: '9:00 AM' }]
    })
    const user = userEvent.setup()
    render(<InstructorAvailability />)
    await waitFor(() => expect(slotButtons('Unavailable')).toHaveLength(1))

    await user.click(screen.getByRole('button', { name: 'Save Availability' }))

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Availability saved!'))
    expect(deleteSpy).toHaveBeenCalled()
    expect(insertSpy).toHaveBeenCalledWith([{ instructor_id: 'inst-1', day: 'Monday', time_slot: '9:00 AM' }])
  })

  it('only deletes, without inserting, when nothing is marked unavailable', async () => {
    const { insertSpy, deleteSpy } = mountSupabase()
    const user = userEvent.setup()
    render(<InstructorAvailability />)
    await screen.findByRole('button', { name: 'Save Availability' })

    await user.click(screen.getByRole('button', { name: 'Save Availability' }))

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Availability saved!'))
    expect(deleteSpy).toHaveBeenCalled()
    expect(insertSpy).not.toHaveBeenCalled()
  })
})
