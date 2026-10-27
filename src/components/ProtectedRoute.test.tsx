import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import ProtectedRoute from './ProtectedRoute'
import { useAuthStore } from '../stores/authStore'

vi.mock('../stores/authStore', () => ({ useAuthStore: vi.fn() }))
vi.mock('./TermsModal', () => ({ default: () => <div>terms modal</div> }))
vi.mock('./AccountPaused', () => ({ default: ({ reason }: { reason: string }) => <div>paused: {reason}</div> }))

const ADMIN = { id: 'u1', full_name: 'Ada', email: 'a@x.com', role: 'admin' as const }
const setTermsAccepted = vi.fn()

function setStore(over: Record<string, unknown> = {}) {
  vi.mocked(useAuthStore).mockReturnValue({
    user: ADMIN, termsAccepted: true, standing: null, initializing: false, setTermsAccepted, ...over
  } as never)
}

function renderRoute(role = 'admin') {
  return render(
    <MemoryRouter initialEntries={['/admin']}>
      <Routes>
        <Route path="/login" element={<div>login page</div>} />
        <Route path="/admin" element={<ProtectedRoute role={role}><div>the app</div></ProtectedRoute>} />
      </Routes>
    </MemoryRouter>
  )
}

describe('ProtectedRoute', () => {
  beforeEach(() => setStore())

  it('shows the app to a signed-in user of the right role', () => {
    renderRoute()
    expect(screen.getByText('the app')).toBeInTheDocument()
  })

  it('shows a loading state, not the login page, while the session is being restored', () => {
    setStore({ user: null, initializing: true })
    renderRoute()
    expect(screen.getByText('Loading...')).toBeInTheDocument()
    expect(screen.queryByText('login page')).not.toBeInTheDocument()
  })

  it('sends a signed-out visitor to the login page', () => {
    setStore({ user: null })
    renderRoute()
    expect(screen.getByText('login page')).toBeInTheDocument()
  })

  it('sends a user with the wrong role to the login page', () => {
    renderRoute('instructor')
    expect(screen.getByText('login page')).toBeInTheDocument()
  })

  it('asks a user who has not accepted the terms to accept them', () => {
    setStore({ termsAccepted: false })
    renderRoute()
    expect(screen.getByText('terms modal')).toBeInTheDocument()
    expect(screen.queryByText('the app')).not.toBeInTheDocument()
  })

  it('shows the paused screen, with the reason, when the organization is suspended', () => {
    setStore({ standing: { subscription_status: 'suspended', trial_ends_at: null, ai_enabled: true } })
    renderRoute()
    expect(screen.getByText(/paused: This account is suspended/)).toBeInTheDocument()
    expect(screen.queryByText('the app')).not.toBeInTheDocument()
  })

  it('shows the paused screen when a trial has ended', () => {
    setStore({ standing: { subscription_status: 'trial', trial_ends_at: '2020-01-01T00:00:00Z', ai_enabled: true } })
    renderRoute()
    expect(screen.getByText(/trial has ended/i)).toBeInTheDocument()
  })

  it('lets an organization with an overdue invoice keep working', () => {
    setStore({ standing: { subscription_status: 'past_due', trial_ends_at: null, ai_enabled: true } })
    renderRoute()
    expect(screen.getByText('the app')).toBeInTheDocument()
  })

  it('does not lock anyone out when standing is unknown', () => {
    setStore({ standing: null })
    renderRoute()
    expect(screen.getByText('the app')).toBeInTheDocument()
  })
})
