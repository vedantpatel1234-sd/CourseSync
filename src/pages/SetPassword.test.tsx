import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import toast from 'react-hot-toast'
import SetPassword from './SetPassword'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../stores/authStore'

vi.mock('../lib/supabase', () => ({
  supabase: { auth: { updateUser: vi.fn() } }
}))

vi.mock('../stores/authStore', () => ({
  useAuthStore: vi.fn()
}))

vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn() }
}))

const INSTRUCTOR = { id: 'u2', full_name: 'Bob Roe', email: 'bob@example.com', role: 'instructor' as const }

function LocationDisplay() {
  const location = useLocation()
  return <div data-testid="location">{location.pathname}</div>
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/set-password']}>
      <SetPassword />
      <LocationDisplay />
    </MemoryRouter>
  )
}

async function fill(user: ReturnType<typeof userEvent.setup>, password: string, confirm: string) {
  await user.type(screen.getByPlaceholderText('Enter a new password'), password)
  await user.type(screen.getByPlaceholderText('Re-enter the password'), confirm)
  await user.click(screen.getByRole('button', { name: 'Save password' }))
}

describe('SetPassword', () => {
  beforeEach(() => {
    vi.mocked(supabase.auth.updateUser).mockReset()
    vi.mocked(toast.success).mockReset()
    vi.mocked(useAuthStore).mockReturnValue({ user: INSTRUCTOR, initializing: false } as never)
  })

  it('shows a loading state while the session from the email link is being restored', () => {
    vi.mocked(useAuthStore).mockReturnValue({ user: null, initializing: true } as never)
    renderPage()

    expect(screen.getByText('Loading...')).toBeInTheDocument()
    expect(screen.queryByText('This link has expired')).not.toBeInTheDocument()
  })

  it('tells visitors without a session the link expired and offers a new one', () => {
    vi.mocked(useAuthStore).mockReturnValue({ user: null, initializing: false } as never)
    renderPage()

    expect(screen.getByText('This link has expired')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Send me a new link' })).toHaveAttribute('href', '/forgot-password')
    expect(screen.queryByRole('button', { name: 'Save password' })).not.toBeInTheDocument()
  })

  it('saves a valid password and sends the user to their dashboard', async () => {
    vi.mocked(supabase.auth.updateUser).mockResolvedValue({ data: {}, error: null } as never)
    const user = userEvent.setup()
    renderPage()

    await fill(user, 'Password1', 'Password1')

    await waitFor(() => expect(supabase.auth.updateUser).toHaveBeenCalledWith({ password: 'Password1' }))
    expect(toast.success).toHaveBeenCalledWith('Password saved')
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/instructor'))
  })

  it('rejects a password that breaks the rules without calling Supabase', async () => {
    const user = userEvent.setup()
    renderPage()

    await fill(user, 'password', 'password')

    expect(await screen.findByText('Password must contain an uppercase letter')).toBeInTheDocument()
    expect(supabase.auth.updateUser).not.toHaveBeenCalled()
  })

  it('rejects mismatched passwords without calling Supabase', async () => {
    const user = userEvent.setup()
    renderPage()

    await fill(user, 'Password1', 'Password2')

    expect(await screen.findByText('Passwords do not match')).toBeInTheDocument()
    expect(supabase.auth.updateUser).not.toHaveBeenCalled()
    expect(screen.getByTestId('location')).toHaveTextContent('/set-password')
  })

  it('shows the server error and stays on the page when the update fails', async () => {
    vi.mocked(supabase.auth.updateUser).mockResolvedValue({
      data: null, error: { message: 'New password should be different from the old password.' }
    } as never)
    const user = userEvent.setup()
    renderPage()

    await fill(user, 'Password1', 'Password1')

    expect(await screen.findByText('New password should be different from the old password.')).toBeInTheDocument()
    expect(toast.success).not.toHaveBeenCalled()
    expect(screen.getByTestId('location')).toHaveTextContent('/set-password')
  })
})
