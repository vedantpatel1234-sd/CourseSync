import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import toast from 'react-hot-toast'
import InstructorNotifications from './Notifications'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../stores/authStore'

vi.mock('../../lib/supabase', () => ({ supabase: { from: vi.fn() } }))
vi.mock('../../stores/authStore', () => ({ useAuthStore: vi.fn() }))
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }))

const INSTRUCTOR_USER = { id: 'inst-1', full_name: 'Jane Doe', email: 'jane@example.com', role: 'instructor' as const }

type Row = Record<string, unknown>

function chainable(data: unknown) {
  const chain: PromiseLike<{ data: unknown; error: null }> & Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    limit: () => chain,
    single: () => chain,
    then: (resolve: (v: { data: unknown; error: null }) => unknown) => Promise.resolve({ data, error: null }).then(resolve)
  } as never
  return chain
}

function mountSupabase(overrides: Partial<{ notification_preferences: Row | null; notifications: Row[] }> = {}) {
  const updateSpy = vi.fn().mockReturnValue(chainable(null))
  const insertSpy = vi.fn().mockResolvedValue({ error: null })
  const prefsRow = 'notification_preferences' in overrides
    ? overrides.notification_preferences
    : { id: 'pref-1', notify_assigned: true, notify_unassigned: true, notify_qualification_verified: true }
  const tables: Record<string, unknown> = {
    notification_preferences: {
      select: () => chainable(prefsRow),
      update: updateSpy,
      insert: insertSpy
    },
    notifications: {
      select: () => chainable(overrides.notifications ?? []),
      update: updateSpy
    }
  }
  vi.mocked(supabase.from).mockImplementation(((table: string) => tables[table]) as never)
  return { updateSpy, insertSpy }
}

describe('InstructorNotifications', () => {
  beforeEach(() => {
    vi.mocked(useAuthStore).mockReturnValue({ user: INSTRUCTOR_USER } as never)
    vi.mocked(toast.success).mockReset()
  })

  it('lists notifications and shows an unread count with a Mark all as read action', async () => {
    mountSupabase({
      notifications: [
        { id: 'n1', type: 'notify_assigned', message: 'You were assigned to CS101.', read: false, created_at: new Date().toISOString() },
        { id: 'n2', type: 'notify_assigned', message: 'You were assigned to CS102.', read: true, created_at: new Date().toISOString() }
      ]
    })
    render(<InstructorNotifications />)

    expect(await screen.findByText('Recent (2)')).toBeInTheDocument()
    expect(screen.getByText('You were assigned to CS101.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mark all as read' })).toBeInTheDocument()
  })

  it('hides "Mark all as read" when nothing is unread', async () => {
    mountSupabase({
      notifications: [{ id: 'n1', type: 'notify_assigned', message: 'Read already.', read: true, created_at: new Date().toISOString() }]
    })
    render(<InstructorNotifications />)
    await screen.findByText('Recent (1)')
    expect(screen.queryByRole('button', { name: 'Mark all as read' })).not.toBeInTheDocument()
  })

  it('shows an empty state with no notifications', async () => {
    mountSupabase()
    render(<InstructorNotifications />)
    expect(await screen.findByText(/Nothing yet/)).toBeInTheDocument()
  })

  it('marks all as read, updating the database and clearing the local unread state', async () => {
    const { updateSpy } = mountSupabase({
      notifications: [{ id: 'n1', type: 'notify_assigned', message: 'You were assigned to CS101.', read: false, created_at: new Date().toISOString() }]
    })
    const user = userEvent.setup()
    render(<InstructorNotifications />)
    await screen.findByText('Recent (1)')

    await user.click(screen.getByRole('button', { name: 'Mark all as read' }))

    expect(updateSpy).toHaveBeenCalledWith({ read: true })
    expect(screen.queryByRole('button', { name: 'Mark all as read' })).not.toBeInTheDocument()
  })

  it('toggling a preference switch changes what gets saved', async () => {
    const { updateSpy } = mountSupabase()
    const user = userEvent.setup()
    render(<InstructorNotifications />)
    const label = await screen.findByText('Notify me when assigned to a section')
    const toggle = label.parentElement!.parentElement!.querySelector('button')!

    await user.click(toggle)
    await user.click(screen.getByRole('button', { name: 'Save Preferences' }))

    await waitFor(() => expect(updateSpy).toHaveBeenCalledWith({
      id: 'pref-1', notify_assigned: false, notify_unassigned: true, notify_qualification_verified: true
    }))
  })

  it('updates existing notification preferences on save', async () => {
    const { updateSpy } = mountSupabase()
    const user = userEvent.setup()
    render(<InstructorNotifications />)
    await screen.findByRole('button', { name: 'Save Preferences' })

    await user.click(screen.getByRole('button', { name: 'Save Preferences' }))

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Notification preferences saved!'))
    expect(updateSpy).toHaveBeenCalledWith({ id: 'pref-1', notify_assigned: true, notify_unassigned: true, notify_qualification_verified: true })
  })

  it('inserts new notification preferences when none exist yet', async () => {
    const { insertSpy } = mountSupabase({ notification_preferences: null })
    const user = userEvent.setup()
    render(<InstructorNotifications />)
    await screen.findByRole('button', { name: 'Save Preferences' })

    await user.click(screen.getByRole('button', { name: 'Save Preferences' }))

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Notification preferences saved!'))
    expect(insertSpy).toHaveBeenCalledWith({
      user_id: 'inst-1', notify_assigned: true, notify_unassigned: true, notify_qualification_verified: true
    })
  })
})
