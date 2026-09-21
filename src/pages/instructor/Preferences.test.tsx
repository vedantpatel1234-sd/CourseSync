import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import toast from 'react-hot-toast'
import InstructorPreferences from './Preferences'
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
    order: () => chain,
    then: (resolve: (v: { data: unknown; error: null }) => unknown) => Promise.resolve({ data, error: null }).then(resolve)
  } as never
  return chain
}

const SECTIONS = [
  { id: 'sec-1', section_number: '01', hours_required: 3, course: { code: 'CS101', name: 'Intro to CS' }, term: { name: 'Winter 2026' } },
  { id: 'sec-2', section_number: '01', hours_required: 4, course: { code: 'CS201', name: 'Data Structures' }, term: { name: 'Winter 2026' } }
]

function mountSupabase(overrides: Partial<{ sections: unknown[]; preferences: unknown[] }> = {}) {
  const insertSpy = vi.fn().mockResolvedValue({ error: null })
  const deleteSpy = vi.fn().mockReturnValue(chainable(null))
  const tables: Record<string, unknown> = {
    sections: chainable(overrides.sections ?? SECTIONS),
    preferences: {
      select: () => chainable(overrides.preferences ?? []),
      delete: deleteSpy,
      insert: insertSpy
    }
  }
  vi.mocked(supabase.from).mockImplementation(((table: string) => tables[table]) as never)
  return { insertSpy, deleteSpy }
}

describe('InstructorPreferences', () => {
  beforeEach(() => {
    vi.mocked(useAuthStore).mockReturnValue({ user: INSTRUCTOR_USER } as never)
    vi.mocked(toast.error).mockReset()
    vi.mocked(toast.success).mockReset()
  })

  it('splits sections between already-ranked and available based on saved preferences', async () => {
    mountSupabase({
      preferences: [{ section_id: 'sec-1', rank: 1, note: 'Preferred morning slot', section: SECTIONS[0] }]
    })
    render(<InstructorPreferences />)

    expect(await screen.findByText('Your Rankings (1)')).toBeInTheDocument()
    expect(screen.getByText('Available Sections (1)')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Preferred morning slot')).toBeInTheDocument()
    expect(screen.getByText('CS201')).toBeInTheDocument()
  })

  it('shows the empty-rankings prompt when nothing is ranked yet', async () => {
    mountSupabase()
    render(<InstructorPreferences />)
    expect(await screen.findByText('Add sections from the right to rank them')).toBeInTheDocument()
  })

  it('moves a section from available to ranked when Add is clicked', async () => {
    mountSupabase()
    const user = userEvent.setup()
    render(<InstructorPreferences />)
    await screen.findByText('Your Rankings (0)')

    await user.click(screen.getAllByRole('button', { name: 'Add' })[0])

    expect(await screen.findByText('Your Rankings (1)')).toBeInTheDocument()
    expect(screen.getByText('Available Sections (1)')).toBeInTheDocument()
  })

  it('moves a section back to available when removed from rankings', async () => {
    mountSupabase({ preferences: [{ section_id: 'sec-1', rank: 1, note: '', section: SECTIONS[0] }] })
    const user = userEvent.setup()
    render(<InstructorPreferences />)
    await screen.findByText('Your Rankings (1)')

    const rankedItem = screen.getByText('CS101').closest('div')!.parentElement!.parentElement!
    await user.click(rankedItem.querySelector('button')!)

    expect(await screen.findByText('Your Rankings (0)')).toBeInTheDocument()
    expect(screen.getByText('Available Sections (2)')).toBeInTheDocument()
  })

  it('saves ranked sections with 1-based rank order and notes, and deletes old preferences first', async () => {
    const { insertSpy, deleteSpy } = mountSupabase({
      preferences: [{ section_id: 'sec-1', rank: 1, note: '', section: SECTIONS[0] }]
    })
    const user = userEvent.setup()
    render(<InstructorPreferences />)
    await screen.findByText('Your Rankings (1)')

    const noteInput = screen.getByPlaceholderText('Add a note (optional)...')
    await user.type(noteInput, 'Great fit')
    await user.click(screen.getByRole('button', { name: 'Save Preferences' }))

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Preferences saved!'))
    expect(deleteSpy).toHaveBeenCalled()
    expect(insertSpy).toHaveBeenCalledWith([
      { instructor_id: 'inst-1', section_id: 'sec-1', rank: 1, note: 'Great fit' }
    ])
  })

  it('only deletes, without inserting, when every ranked section has been removed', async () => {
    const { insertSpy, deleteSpy } = mountSupabase({
      preferences: [{ section_id: 'sec-1', rank: 1, note: '', section: SECTIONS[0] }]
    })
    const user = userEvent.setup()
    render(<InstructorPreferences />)
    await screen.findByText('Your Rankings (1)')

    const rankedItem = screen.getByText('CS101').closest('div')!.parentElement!.parentElement!
    await user.click(rankedItem.querySelector('button')!)
    await screen.findByText('Your Rankings (0)')
    await user.click(screen.getByRole('button', { name: 'Save Preferences' }))

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Preferences saved!'))
    expect(deleteSpy).toHaveBeenCalled()
    expect(insertSpy).not.toHaveBeenCalled()
  })

  it('shows an error toast when saving fails', async () => {
    const { insertSpy } = mountSupabase({ preferences: [{ section_id: 'sec-1', rank: 1, note: '', section: SECTIONS[0] }] })
    insertSpy.mockResolvedValue({ error: { message: 'db error' } })
    const user = userEvent.setup()
    render(<InstructorPreferences />)
    await screen.findByText('Your Rankings (1)')

    await user.click(screen.getByRole('button', { name: 'Save Preferences' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('db error'))
  })
})
