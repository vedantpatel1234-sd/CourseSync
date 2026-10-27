import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AccountPaused from './AccountPaused'
import { useAuthStore } from '../stores/authStore'

vi.mock('../stores/authStore', () => ({ useAuthStore: vi.fn() }))

const signOut = vi.fn()

function setStore(role: string, organizationName: string | null = 'Fraser Valley College') {
  vi.mocked(useAuthStore).mockReturnValue({
    user: { id: 'u1', full_name: 'X', email: 'x@x.com', role }, organizationName, signOut
  } as never)
}

describe('AccountPaused', () => {
  beforeEach(() => signOut.mockReset())

  it('names the organization and explains why', () => {
    setStore('admin')
    render(<AccountPaused reason="This account is suspended. Contact us to restore access." />)
    expect(screen.getByRole('heading', { name: 'Fraser Valley College is paused' })).toBeInTheDocument()
    expect(screen.getByText('This account is suspended. Contact us to restore access.')).toBeInTheDocument()
  })

  it('falls back to a generic heading when the organization name is unknown', () => {
    setStore('admin', null)
    render(<AccountPaused reason="x" />)
    expect(screen.getByRole('heading', { name: 'Your account is paused' })).toBeInTheDocument()
  })

  it('reassures an admin that nothing was deleted', () => {
    setStore('admin')
    render(<AccountPaused reason="x" />)
    expect(screen.getByText(/Your data is safe and nothing has been deleted/)).toBeInTheDocument()
  })

  it('tells an instructor to ask their administrator', () => {
    setStore('instructor')
    render(<AccountPaused reason="x" />)
    expect(screen.getByText(/ask your department administrator/i)).toBeInTheDocument()
    expect(screen.queryByText(/data is safe/i)).not.toBeInTheDocument()
  })

  it('always lets the user sign out', async () => {
    setStore('instructor')
    const user = userEvent.setup()
    render(<AccountPaused reason="x" />)
    await user.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(signOut).toHaveBeenCalled()
  })
})
