import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ErrorBoundary from './ErrorBoundary'
import { reportError } from '../lib/errorReporting'

vi.mock('../lib/errorReporting', () => ({ reportError: vi.fn() }))

function Bomb({ explode }: { explode: boolean }) {
  if (explode) throw new Error('render exploded')
  return <div>all good</div>
}

describe('ErrorBoundary', () => {
  beforeEach(() => {
    vi.mocked(reportError).mockReset()
    // React logs caught render errors to the console; keep the test output readable.
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => vi.restoreAllMocks())

  it('shows the page normally when nothing goes wrong', () => {
    render(<ErrorBoundary><Bomb explode={false} /></ErrorBoundary>)
    expect(screen.getByText('all good')).toBeInTheDocument()
    expect(reportError).not.toHaveBeenCalled()
  })

  it('replaces a crashed page with a calm message instead of a blank screen', () => {
    render(<ErrorBoundary><Bomb explode /></ErrorBoundary>)
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong')
    expect(screen.getByRole('alert')).toHaveTextContent(/Your data is safe/)
    expect(screen.queryByText('all good')).not.toBeInTheDocument()
  })

  it('reports the error, with the component stack, as a boundary error', () => {
    render(<ErrorBoundary><Bomb explode /></ErrorBoundary>)
    expect(reportError).toHaveBeenCalledTimes(1)
    const [error, source, extra] = vi.mocked(reportError).mock.calls[0]
    expect((error as Error).message).toBe('render exploded')
    expect(source).toBe('boundary')
    expect(extra).toContain('Component stack:')
  })

  it('offers a way out: reload, or back to the sign-in page', async () => {
    const reload = vi.fn()
    vi.stubGlobal('location', { ...window.location, reload })
    const user = userEvent.setup()
    render(<ErrorBoundary><Bomb explode /></ErrorBoundary>)

    await user.click(screen.getByRole('button', { name: 'Reload page' }))
    expect(reload).toHaveBeenCalled()
    expect(screen.getByRole('link', { name: 'Back to sign in' })).toHaveAttribute('href', '/login')
    vi.unstubAllGlobals()
  })
})
