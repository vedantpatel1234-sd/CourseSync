import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import toast from 'react-hot-toast'
import AdminMatching from './Matching'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../stores/authStore'
import { logAction } from '../../lib/audit'
import { notifyInstructor } from '../../lib/notifications'

vi.mock('../../lib/supabase', () => ({ supabase: { from: vi.fn() } }))
vi.mock('../../stores/authStore', () => ({ useAuthStore: vi.fn() }))
vi.mock('../../lib/audit', () => ({ logAction: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../../lib/notifications', () => ({ notifyInstructor: vi.fn().mockResolvedValue(undefined) }))
vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() })
}))

const ADMIN_USER = { id: 'admin-1', full_name: 'Admin', email: 'admin@example.com', role: 'admin' as const }

type Row = Record<string, unknown>

function chainable(data: unknown) {
  const chain: PromiseLike<{ data: unknown; error: null }> & Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    is: () => chain,
    neq: () => chain,
    order: () => chain,
    then: (resolve: (v: { data: unknown; error: null }) => unknown) => Promise.resolve({ data, error: null }).then(resolve)
  } as never
  return chain
}

function insertTrackingTable() {
  const insertSpy = vi.fn().mockResolvedValue({ error: null })
  return { select: () => chainable([]), insert: insertSpy, insertSpy }
}

function mountSupabase(overrides: Partial<{
  sections: Row[]; profiles: Row[]; assignments: Row[]; instructor_availability: Row[]; qualifications: Row[]; preferences: Row[]
}> = {}) {
  const assignmentsTable = insertTrackingTable()
  const tables: Record<string, unknown> = {
    sections: chainable(overrides.sections ?? []),
    profiles: chainable(overrides.profiles ?? []),
    assignments: { ...assignmentsTable, select: () => chainable(overrides.assignments ?? []) },
    instructor_availability: chainable(overrides.instructor_availability ?? []),
    qualifications: chainable(overrides.qualifications ?? []),
    preferences: chainable(overrides.preferences ?? [])
  }
  vi.mocked(supabase.from).mockImplementation(((table: string) => tables[table]) as never)
  return { assignmentsInsertSpy: assignmentsTable.insertSpy }
}

const SECTION_CS101: Row = { id: 'sec-1', section_number: '01', hours_required: 3, status: 'unassigned', day_of_week: 'Monday', time_slot: '9:00 AM', course: { code: 'CS101', name: 'Intro to CS' }, term: { name: 'Winter 2026' } }
const INST_JANE: Row = { id: 'inst-1', full_name: 'Jane Doe', instructor_profiles: { max_hours_per_term: 40 } }
const INST_BOB: Row = { id: 'inst-2', full_name: 'Bob Roe', instructor_profiles: { max_hours_per_term: 40 } }

describe('AdminMatching', () => {
  beforeEach(() => {
    vi.mocked(useAuthStore).mockReturnValue({ user: ADMIN_USER } as never)
    vi.mocked(toast).mockReset()
    vi.mocked(toast.error).mockReset()
    vi.mocked(toast.success).mockReset()
    vi.mocked(logAction).mockClear()
    vi.mocked(notifyInstructor).mockClear()
  })

  it('shows an info toast and no table when every section is already assigned', async () => {
    mountSupabase({ sections: [] })
    const user = userEvent.setup()
    render(<AdminMatching />)

    await user.click(screen.getByRole('button', { name: /Run Matching/ }))

    await waitFor(() => expect(toast).toHaveBeenCalledWith('All sections are already assigned!', { icon: 'ℹ️' }))
    expect(screen.queryByText(/Section.*Day/)).not.toBeInTheDocument()
  })

  it('excludes a conflicted instructor entirely rather than scoring them low', async () => {
    mountSupabase({
      sections: [SECTION_CS101],
      profiles: [INST_JANE],
      instructor_availability: [{ instructor_id: 'inst-1', day: 'Monday', time_slot: '9:00 AM' }]
    })
    const user = userEvent.setup()
    render(<AdminMatching />)

    await user.click(screen.getByRole('button', { name: /Run Matching/ }))

    expect(await screen.findByText('All sections are assigned! 🎉')).toBeInTheDocument()
    expect(screen.getByText(/Skipped 1 instructor match due to scheduling conflicts/)).toBeInTheDocument()
  })

  it('scores a qualified, preferred, in-budget instructor higher than an unqualified one', async () => {
    mountSupabase({
      sections: [SECTION_CS101],
      profiles: [INST_JANE, INST_BOB],
      qualifications: [{ instructor_id: 'inst-1', course_id: 'course-1', verified: true }],
      preferences: [{ instructor_id: 'inst-1', section_id: 'sec-1', rank: 1 }]
    })
    const user = userEvent.setup()
    render(<AdminMatching />)

    await user.click(screen.getByRole('button', { name: /Run Matching/ }))

    expect(await screen.findByText('Jane Doe')).toBeInTheDocument()
    expect(screen.getByText('100pts')).toBeInTheDocument() // 40 hours + 30 qual + 30 pref#1
    expect(screen.getByText('Rank #1')).toBeInTheDocument()
    expect(screen.queryByText('Bob Roe')).not.toBeInTheDocument()
  })

  it('never proposes the same instructor for two different sections in one run', async () => {
    const SECTION_2: Row = { ...SECTION_CS101, id: 'sec-2', day_of_week: 'Tuesday', time_slot: '10:00 AM', course: { code: 'CS102', name: 'Data Structures' } }
    mountSupabase({
      sections: [SECTION_CS101, SECTION_2],
      profiles: [INST_JANE]
    })
    const user = userEvent.setup()
    render(<AdminMatching />)

    await user.click(screen.getByRole('button', { name: /Run Matching/ }))

    expect(await screen.findAllByText('Jane Doe')).toHaveLength(1)
    expect(screen.getByText('CS101')).toBeInTheDocument()
    expect(screen.queryByText('CS102')).not.toBeInTheDocument()
  })

  it('accepts only hours-ok suggestions with Accept All, and publishes only accepted ones', async () => {
    const { assignmentsInsertSpy } = mountSupabase({
      sections: [SECTION_CS101],
      profiles: [INST_JANE]
    })
    const user = userEvent.setup()
    render(<AdminMatching />)
    await user.click(screen.getByRole('button', { name: /Run Matching/ }))
    await screen.findByText('Jane Doe')

    await user.click(screen.getByRole('button', { name: 'Accept All' }))
    expect(await screen.findByRole('button', { name: '✓ Accepted' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Publish Accepted' }))

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('1 assignments published!'))
    expect(assignmentsInsertSpy).toHaveBeenCalledWith(expect.objectContaining({ instructor_id: 'inst-1', section_id: 'sec-1' }))
    expect(notifyInstructor).toHaveBeenCalledWith('inst-1', 'notify_assigned', expect.stringContaining('CS101'))
    expect(logAction).toHaveBeenCalledWith('admin-1', 'matching_published', 'assignment', undefined, { count: 1 })
    // Publishing resets the results view.
    expect(screen.queryByRole('button', { name: 'Publish Accepted' })).not.toBeInTheDocument()
  })

  it('refuses to publish when nothing has been accepted', async () => {
    mountSupabase({ sections: [SECTION_CS101], profiles: [INST_JANE] })
    const user = userEvent.setup()
    render(<AdminMatching />)
    await user.click(screen.getByRole('button', { name: /Run Matching/ }))
    await screen.findByText('Jane Doe')

    await user.click(screen.getByRole('button', { name: 'Publish Accepted' }))

    expect(toast.error).toHaveBeenCalledWith('No suggestions accepted')
  })

  it('toggles a single suggestion accepted and back', async () => {
    mountSupabase({ sections: [SECTION_CS101], profiles: [INST_JANE] })
    const user = userEvent.setup()
    render(<AdminMatching />)
    await user.click(screen.getByRole('button', { name: /Run Matching/ }))
    await screen.findByText('Jane Doe')

    await user.click(screen.getByRole('button', { name: 'Accept' }))
    expect(await screen.findByRole('button', { name: '✓ Accepted' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '✓ Accepted' }))
    expect(await screen.findByRole('button', { name: 'Accept' })).toBeInTheDocument()
  })
})
