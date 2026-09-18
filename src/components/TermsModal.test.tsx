import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import toast from 'react-hot-toast'
import TermsModal from './TermsModal'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../stores/authStore'

vi.mock('../lib/supabase', () => ({
  supabase: { from: vi.fn() }
}))

vi.mock('../stores/authStore', () => ({
  useAuthStore: vi.fn()
}))

vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn() }
}))

const USER = { id: 'user-1', full_name: 'Jane Doe', email: 'jane@example.com', role: 'admin' as const }

describe('TermsModal', () => {
  beforeEach(() => {
    vi.mocked(useAuthStore).mockReturnValue({ user: USER } as never)
    vi.mocked(toast.error).mockReset()
    vi.mocked(toast.success).mockReset()
  })

  it('disables the accept button until the checkbox is checked', async () => {
    vi.mocked(supabase.from).mockReturnValue({ insert: vi.fn() } as never)
    const user = userEvent.setup()
    render(<TermsModal onAccepted={vi.fn()} />)

    const acceptButton = screen.getByRole('button', { name: 'Accept & Continue' })
    expect(acceptButton).toBeDisabled()

    await user.click(screen.getByRole('checkbox'))
    expect(acceptButton).toBeEnabled()
  })

  it('inserts an acceptance row and calls onAccepted on success', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null })
    vi.mocked(supabase.from).mockReturnValue({ insert } as never)
    const onAccepted = vi.fn()
    const user = userEvent.setup()

    render(<TermsModal onAccepted={onAccepted} />)
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'Accept & Continue' }))

    await waitFor(() => expect(onAccepted).toHaveBeenCalledTimes(1))
    expect(supabase.from).toHaveBeenCalledWith('terms_acceptance')
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'user-1', version: '1.0' }))
    expect(toast.success).toHaveBeenCalled()
  })

  it('shows an error toast and does not call onAccepted when the insert fails', async () => {
    const insert = vi.fn().mockResolvedValue({ error: { message: 'db error' } })
    vi.mocked(supabase.from).mockReturnValue({ insert } as never)
    const onAccepted = vi.fn()
    const user = userEvent.setup()

    render(<TermsModal onAccepted={onAccepted} />)
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'Accept & Continue' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(onAccepted).not.toHaveBeenCalled()
  })
})
