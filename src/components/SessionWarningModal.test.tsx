import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SessionWarningModal from './SessionWarningModal'

describe('SessionWarningModal', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders the initial countdown as minutes:seconds', () => {
    render(<SessionWarningModal secondsLeft={125} onStayLoggedIn={vi.fn()} onLogout={vi.fn()} />)
    expect(screen.getByText('2:05')).toBeInTheDocument()
  })

  it('pads single-digit seconds with a leading zero', () => {
    render(<SessionWarningModal secondsLeft={65} onStayLoggedIn={vi.fn()} onLogout={vi.fn()} />)
    expect(screen.getByText('1:05')).toBeInTheDocument()
  })

  async function tick(seconds: number) {
    for (let i = 0; i < seconds; i++) {
      await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    }
  }

  it('counts down by one every second', async () => {
    vi.useFakeTimers()
    render(<SessionWarningModal secondsLeft={10} onStayLoggedIn={vi.fn()} onLogout={vi.fn()} />)
    expect(screen.getByText('0:10')).toBeInTheDocument()
    await tick(1)
    expect(screen.getByText('0:09')).toBeInTheDocument()
    await tick(3)
    expect(screen.getByText('0:06')).toBeInTheDocument()
  })

  it('calls onLogout automatically once the countdown reaches zero', async () => {
    vi.useFakeTimers()
    const onLogout = vi.fn()
    render(<SessionWarningModal secondsLeft={2} onStayLoggedIn={vi.fn()} onLogout={onLogout} />)
    expect(onLogout).not.toHaveBeenCalled()
    await tick(2)
    expect(onLogout).toHaveBeenCalledTimes(1)
  })

  it('calls onStayLoggedIn when "Stay signed in" is clicked', async () => {
    const user = userEvent.setup()
    const onStayLoggedIn = vi.fn()
    render(<SessionWarningModal secondsLeft={60} onStayLoggedIn={onStayLoggedIn} onLogout={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Stay signed in' }))
    expect(onStayLoggedIn).toHaveBeenCalledTimes(1)
  })

  it('calls onLogout immediately when "Sign out" is clicked', async () => {
    const user = userEvent.setup()
    const onLogout = vi.fn()
    render(<SessionWarningModal secondsLeft={60} onStayLoggedIn={vi.fn()} onLogout={onLogout} />)
    await user.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(onLogout).toHaveBeenCalledTimes(1)
  })

  it('resets the countdown when secondsLeft prop changes', async () => {
    vi.useFakeTimers()
    const { rerender } = render(<SessionWarningModal secondsLeft={30} onStayLoggedIn={vi.fn()} onLogout={vi.fn()} />)
    await tick(5)
    expect(screen.getByText('0:25')).toBeInTheDocument()
    rerender(<SessionWarningModal secondsLeft={45} onStayLoggedIn={vi.fn()} onLogout={vi.fn()} />)
    expect(screen.getByText('0:45')).toBeInTheDocument()
  })
})
