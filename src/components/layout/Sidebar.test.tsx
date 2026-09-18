import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import Sidebar from './Sidebar'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../stores/authStore'

vi.mock('../../lib/supabase', () => ({
  supabase: { from: vi.fn() }
}))

vi.mock('../../stores/authStore', () => ({
  useAuthStore: vi.fn()
}))

const ADMIN_USER = { id: 'user-1', full_name: 'Jane Doe', email: 'jane@example.com', role: 'admin' as const }
const INSTRUCTOR_USER = { id: 'user-2', full_name: 'Bob Roe', email: 'bob@example.com', role: 'instructor' as const }

function LocationDisplay() {
  const location = useLocation()
  return <div data-testid="location">{location.pathname}</div>
}

function renderSidebar(initialEntry = '/admin') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Sidebar />
      <LocationDisplay />
    </MemoryRouter>
  )
}

describe('Sidebar', () => {
  beforeEach(() => {
    vi.mocked(supabase.from).mockReset()
  })

  it('renders the admin nav and user info', () => {
    vi.mocked(useAuthStore).mockReturnValue({ user: ADMIN_USER, signOut: vi.fn() } as never)
    renderSidebar()

    expect(screen.getByText('Dashboard')).toBeInTheDocument()
    expect(screen.getByText('Terms')).toBeInTheDocument()
    expect(screen.getByText('Calendar')).toBeInTheDocument()
    expect(screen.getByText('Jane Doe')).toBeInTheDocument()
    expect(screen.getByText('JD')).toBeInTheDocument()
    // Instructor-only nav must not leak into the admin sidebar.
    expect(screen.queryByText('My Assignments')).not.toBeInTheDocument()
  })

  describe('sign-out confirmation', () => {
    it('does not sign out immediately — it asks for confirmation first', async () => {
      const signOut = vi.fn().mockResolvedValue(undefined)
      vi.mocked(useAuthStore).mockReturnValue({ user: ADMIN_USER, signOut } as never)
      const user = userEvent.setup()
      renderSidebar()

      await user.click(screen.getByRole('button', { name: /sign out/i }))

      expect(screen.getByText('Sign out?')).toBeInTheDocument()
      expect(signOut).not.toHaveBeenCalled()
    })

    it('cancels without signing out', async () => {
      const signOut = vi.fn().mockResolvedValue(undefined)
      vi.mocked(useAuthStore).mockReturnValue({ user: ADMIN_USER, signOut } as never)
      const user = userEvent.setup()
      renderSidebar()

      await user.click(screen.getByRole('button', { name: /sign out/i }))
      await user.click(screen.getByRole('button', { name: 'Cancel' }))

      expect(screen.queryByText('Sign out?')).not.toBeInTheDocument()
      expect(signOut).not.toHaveBeenCalled()
    })

    it('signs out and navigates to /login when confirmed', async () => {
      const signOut = vi.fn().mockResolvedValue(undefined)
      vi.mocked(useAuthStore).mockReturnValue({ user: ADMIN_USER, signOut } as never)
      const user = userEvent.setup()
      renderSidebar()

      await user.click(screen.getByRole('button', { name: /sign out/i }))
      // Two "Sign out" buttons exist once the modal is open: the sidebar trigger and the modal's confirm button.
      const confirmButton = screen.getAllByRole('button', { name: 'Sign out' }).slice(-1)[0]
      await user.click(confirmButton)

      await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1))
      await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/login'))
    })
  })

  describe('mobile drawer', () => {
    it('opens via the hamburger and closes via the backdrop', async () => {
      vi.mocked(useAuthStore).mockReturnValue({ user: ADMIN_USER, signOut: vi.fn() } as never)
      const user = userEvent.setup()
      const { container } = renderSidebar()

      expect(container.querySelector('.app-sidebar')).not.toHaveClass('open')
      expect(screen.getByLabelText('Open menu')).toBeInTheDocument()

      await user.click(screen.getByLabelText('Open menu'))

      expect(container.querySelector('.app-sidebar')).toHaveClass('open')
      expect(container.querySelector('.sidebar-backdrop')).toHaveClass('open')
      expect(screen.queryByLabelText('Open menu')).not.toBeInTheDocument()

      await user.click(container.querySelector('.sidebar-backdrop')!)

      expect(container.querySelector('.app-sidebar')).not.toHaveClass('open')
      expect(screen.getByLabelText('Open menu')).toBeInTheDocument()
    })

    it('closes the drawer when a nav link is clicked', async () => {
      vi.mocked(useAuthStore).mockReturnValue({ user: ADMIN_USER, signOut: vi.fn() } as never)
      const user = userEvent.setup()
      const { container } = renderSidebar()

      await user.click(screen.getByLabelText('Open menu'))
      expect(container.querySelector('.app-sidebar')).toHaveClass('open')

      await user.click(screen.getByText('Courses'))

      expect(container.querySelector('.app-sidebar')).not.toHaveClass('open')
    })
  })

  describe('instructor notification badge', () => {
    it('shows the unread count for an instructor', async () => {
      vi.mocked(useAuthStore).mockReturnValue({ user: INSTRUCTOR_USER, signOut: vi.fn() } as never)
      const chain = {
        select: () => chain,
        eq: () => chain,
        then: (resolve: (v: { count: number }) => unknown) => Promise.resolve({ count: 4 }).then(resolve)
      }
      vi.mocked(supabase.from).mockReturnValue(chain as never)

      renderSidebar('/instructor')

      expect(await screen.findByText('4')).toBeInTheDocument()
    })

    it('caps the displayed badge at "9+"', async () => {
      vi.mocked(useAuthStore).mockReturnValue({ user: INSTRUCTOR_USER, signOut: vi.fn() } as never)
      const chain = {
        select: () => chain,
        eq: () => chain,
        then: (resolve: (v: { count: number }) => unknown) => Promise.resolve({ count: 15 }).then(resolve)
      }
      vi.mocked(supabase.from).mockReturnValue(chain as never)

      renderSidebar('/instructor')

      expect(await screen.findByText('9+')).toBeInTheDocument()
    })

    it('does not query notifications for a non-instructor role', () => {
      vi.mocked(useAuthStore).mockReturnValue({ user: ADMIN_USER, signOut: vi.fn() } as never)
      renderSidebar()
      expect(supabase.from).not.toHaveBeenCalled()
    })
  })
})
