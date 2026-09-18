import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import toast from 'react-hot-toast'
import LoginPage from './LoginPage'
import { useAuthStore } from '../stores/authStore'

vi.mock('../stores/authStore', () => ({
  useAuthStore: Object.assign(vi.fn(), { getState: vi.fn() })
}))

vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn() }
}))

function LocationDisplay() {
  const location = useLocation()
  return <div data-testid="location">{location.pathname}</div>
}

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <LoginPage />
      <LocationDisplay />
    </MemoryRouter>
  )
}

describe('LoginPage', () => {
  const mockSignIn = vi.fn()

  beforeEach(() => {
    mockSignIn.mockReset()
    vi.mocked(useAuthStore).mockReturnValue({ signIn: mockSignIn, loading: false } as never)
    vi.mocked(useAuthStore.getState).mockReturnValue({ user: null } as never)
    vi.mocked(toast.error).mockReset()
  })

  it('renders the sign-in form and demo account shortcuts', () => {
    renderLogin()
    expect(screen.getByPlaceholderText('you@example.com')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Enter your password')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'admin' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'instructor' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'coordinator' })).toBeInTheDocument()
  })

  it('lets the user type an email and password', async () => {
    const user = userEvent.setup()
    renderLogin()
    const emailInput = screen.getByPlaceholderText('you@example.com') as HTMLInputElement
    const passwordInput = screen.getByPlaceholderText('Enter your password') as HTMLInputElement

    await user.type(emailInput, 'jane@example.com')
    await user.type(passwordInput, 'secret123')

    expect(emailInput.value).toBe('jane@example.com')
    expect(passwordInput.value).toBe('secret123')
  })

  it('toggles the password field between hidden and visible', async () => {
    const user = userEvent.setup()
    renderLogin()
    const passwordInput = screen.getByPlaceholderText('Enter your password') as HTMLInputElement
    expect(passwordInput.type).toBe('password')

    const toggleButtons = screen.getAllByRole('button').filter(b => b.getAttribute('type') === 'button' && !['admin', 'instructor', 'coordinator'].includes(b.textContent || ''))
    await user.click(toggleButtons[0])
    expect(passwordInput.type).toBe('text')

    await user.click(toggleButtons[0])
    expect(passwordInput.type).toBe('password')
  })

  it('fills in demo credentials when a demo account button is clicked', async () => {
    const user = userEvent.setup()
    renderLogin()
    await user.click(screen.getByRole('button', { name: 'instructor' }))

    expect((screen.getByPlaceholderText('you@example.com') as HTMLInputElement).value).toBe('instructor@demo.ca')
    expect((screen.getByPlaceholderText('Enter your password') as HTMLInputElement).value).toBe('Demo@1234')
  })

  it.each([
    ['admin', '/admin'],
    ['instructor', '/instructor'],
    ['coordinator', '/coordinator']
  ])('signs in as %s and navigates to %s', async (role, expectedPath) => {
    mockSignIn.mockResolvedValue({ error: null })
    vi.mocked(useAuthStore.getState).mockReturnValue({ user: { id: 'u1', full_name: 'Test', email: 'test@example.com', role } } as never)
    const user = userEvent.setup()
    renderLogin()

    await user.type(screen.getByPlaceholderText('you@example.com'), 'test@example.com')
    await user.type(screen.getByPlaceholderText('Enter your password'), 'password123')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() => expect(mockSignIn).toHaveBeenCalledWith('test@example.com', 'password123'))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(expectedPath))
  })

  it('shows an error and does not navigate when sign-in fails', async () => {
    mockSignIn.mockResolvedValue({ error: 'Invalid email or password' })
    const user = userEvent.setup()
    renderLogin()

    await user.type(screen.getByPlaceholderText('you@example.com'), 'wrong@example.com')
    await user.type(screen.getByPlaceholderText('Enter your password'), 'badpassword')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() => expect(screen.getByText('Invalid email or password')).toBeInTheDocument())
    expect(toast.error).toHaveBeenCalledWith('Invalid email or password')
    expect(screen.getByTestId('location')).toHaveTextContent('/login')
  })

  it('disables the submit button and shows a loading label while signing in', () => {
    vi.mocked(useAuthStore).mockReturnValue({ signIn: mockSignIn, loading: true } as never)
    renderLogin()
    const button = screen.getByRole('button', { name: 'Signing in...' })
    expect(button).toBeDisabled()
  })
})
