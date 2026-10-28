import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import SessionWarningModal from './SessionWarningModal'
import TermsModal from './TermsModal'
import Sidebar from './layout/Sidebar'
import { useAuthStore } from '../stores/authStore'
import { accessibilityViolations } from '../test/axe'

vi.mock('../lib/supabase', () => ({
  supabase: { from: vi.fn(), rpc: vi.fn(), auth: { signOut: vi.fn().mockResolvedValue({}) } }
}))
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }))

const USER = { id: 'u1', full_name: 'Jane Doe', email: 'jane@example.com', role: 'admin' as const }

describe('modal dialogs are real dialogs', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: USER, organizationName: 'Test College', standing: null })
  })

  describe('session warning', () => {
    it('is announced as an alert dialog with a name and a description, and starts on the safe choice', async () => {
      render(<SessionWarningModal secondsLeft={60} onStayLoggedIn={() => {}} onLogout={() => {}} />)
      const dialog = screen.getByRole('alertdialog', { name: 'Are you still there?' })
      expect(dialog).toHaveAttribute('aria-modal', 'true')
      expect(dialog).toHaveAccessibleDescription(/inactive/i)
      expect(screen.getByRole('button', { name: 'Stay signed in' })).toHaveFocus()
      expect(await accessibilityViolations()).toEqual([])
    })

    it('Escape means "stay signed in", never sign out', async () => {
      const user = userEvent.setup()
      const stay = vi.fn(); const out = vi.fn()
      render(<SessionWarningModal secondsLeft={60} onStayLoggedIn={stay} onLogout={out} />)
      await user.keyboard('{Escape}')
      expect(stay).toHaveBeenCalledTimes(1)
      expect(out).not.toHaveBeenCalled()
    })
  })

  describe('terms of service', () => {
    it('is a named modal dialog, focus starts inside it, and it passes axe', async () => {
      render(<TermsModal onAccepted={() => {}} />)
      const dialog = screen.getByRole('dialog', { name: 'Welcome to CourseSync' })
      expect(dialog).toHaveAttribute('aria-modal', 'true')
      expect(dialog).toContainElement(document.activeElement as HTMLElement)
      expect(await accessibilityViolations()).toEqual([])
    })

    it('cannot be dismissed with Escape: acceptance is required to continue', async () => {
      const user = userEvent.setup()
      render(<TermsModal onAccepted={() => {}} />)
      await user.keyboard('{Escape}')
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })
  })

  describe('sign-out confirmation', () => {
    function renderSidebar() {
      return render(<MemoryRouter><Sidebar /></MemoryRouter>)
    }

    it('is a named dialog, starts on Cancel, and Escape cancels', async () => {
      const user = userEvent.setup()
      renderSidebar()
      await user.click(screen.getByRole('button', { name: 'Sign out' }))
      const dialog = screen.getByRole('dialog', { name: 'Sign out?' })
      expect(dialog).toHaveAccessibleDescription(/sign back in/i)
      expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
      await user.keyboard('{Escape}')
      expect(screen.queryByRole('dialog')).toBeNull()
    })

    it('returns focus to the Sign out button afterwards', async () => {
      const user = userEvent.setup()
      renderSidebar()
      const trigger = screen.getByRole('button', { name: 'Sign out' })
      await user.click(trigger)
      await user.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(trigger).toHaveFocus()
    })

    it('is rendered outside the sidebar, so a transformed mobile drawer cannot clip it', async () => {
      const user = userEvent.setup()
      renderSidebar()
      await user.click(screen.getByRole('button', { name: 'Sign out' }))
      expect(document.querySelector('#app-sidebar')?.contains(screen.getByRole('dialog'))).toBe(false)
    })
  })

  describe('mobile menu', () => {
    it('opens with focus on the first link, closes on Escape, and returns focus to the menu button', async () => {
      const user = userEvent.setup()
      render(<MemoryRouter><Sidebar /></MemoryRouter>)
      const menu = screen.getByRole('button', { name: 'Open menu' })
      expect(menu).toHaveAttribute('aria-expanded', 'false')
      expect(menu).toHaveAttribute('aria-controls', 'app-sidebar')
      await user.click(menu)
      expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveFocus()
      await user.keyboard('{Escape}')
      expect(screen.getByRole('button', { name: 'Open menu' })).toHaveFocus()
    })
  })
})
