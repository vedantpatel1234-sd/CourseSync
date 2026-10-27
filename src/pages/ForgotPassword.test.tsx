import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import toast from 'react-hot-toast'
import ForgotPassword from './ForgotPassword'
import { supabase } from '../lib/supabase'

vi.mock('../lib/supabase', () => ({
  supabase: { auth: { resetPasswordForEmail: vi.fn() } }
}))

vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn() }
}))

function renderPage() {
  return render(<MemoryRouter><ForgotPassword /></MemoryRouter>)
}

describe('ForgotPassword', () => {
  beforeEach(() => {
    vi.mocked(supabase.auth.resetPasswordForEmail).mockReset()
    vi.mocked(toast.error).mockReset()
  })

  it('sends a reset link that returns to /set-password and confirms generically', async () => {
    vi.mocked(supabase.auth.resetPasswordForEmail).mockResolvedValue({ data: {}, error: null } as never)
    const user = userEvent.setup()
    renderPage()

    await user.type(screen.getByPlaceholderText('you@example.com'), 'jane@example.com')
    await user.click(screen.getByRole('button', { name: 'Send reset link' }))

    await waitFor(() => expect(supabase.auth.resetPasswordForEmail).toHaveBeenCalledWith('jane@example.com', {
      redirectTo: `${window.location.origin}/set-password`
    }))
    expect(await screen.findByText(/If an account exists for/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to sign in' })).toHaveAttribute('href', '/login')
  })

  it('rejects an address without a domain dot (which the browser lets through) without calling Supabase', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.type(screen.getByPlaceholderText('you@example.com'), 'jane@localhost')
    await user.click(screen.getByRole('button', { name: 'Send reset link' }))

    expect(toast.error).toHaveBeenCalledWith('Enter a valid email address')
    expect(supabase.auth.resetPasswordForEmail).not.toHaveBeenCalled()
  })

  it('shows the error and stays on the form when sending fails', async () => {
    vi.mocked(supabase.auth.resetPasswordForEmail).mockResolvedValue({
      data: null, error: { message: 'Email rate limit exceeded' }
    } as never)
    const user = userEvent.setup()
    renderPage()

    await user.type(screen.getByPlaceholderText('you@example.com'), 'jane@example.com')
    await user.click(screen.getByRole('button', { name: 'Send reset link' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Email rate limit exceeded'))
    expect(screen.queryByText(/If an account exists for/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send reset link' })).toBeInTheDocument()
  })
})
