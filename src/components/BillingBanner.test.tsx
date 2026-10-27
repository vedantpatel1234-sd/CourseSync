import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import BillingBanner from './BillingBanner'
import { useAuthStore } from '../stores/authStore'

vi.mock('../stores/authStore', () => ({ useAuthStore: vi.fn() }))

const DAY = 24 * 60 * 60 * 1000

function renderBanner(role: string, standing: unknown) {
  vi.mocked(useAuthStore).mockReturnValue({ user: { role }, standing } as never)
  return render(<MemoryRouter><BillingBanner /></MemoryRouter>)
}

describe('BillingBanner', () => {
  it('warns an admin about an overdue invoice and links to the billing page', () => {
    renderBanner('admin', { subscription_status: 'past_due', trial_ends_at: null, ai_enabled: true })
    expect(screen.getByRole('status')).toHaveTextContent(/invoice is overdue/i)
    expect(screen.getByRole('link', { name: 'Billing & usage' })).toHaveAttribute('href', '/admin/billing')
  })

  it('counts down the last days of a trial', () => {
    renderBanner('admin', {
      subscription_status: 'trial', trial_ends_at: new Date(Date.now() + 5 * DAY).toISOString(), ai_enabled: true
    })
    expect(screen.getByRole('status')).toHaveTextContent(/trial ends in/i)
  })

  it('shows nothing to an instructor, even when payment is overdue', () => {
    renderBanner('instructor', { subscription_status: 'past_due', trial_ends_at: null, ai_enabled: true })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('shows nothing for a healthy account or unknown standing', () => {
    renderBanner('admin', { subscription_status: 'active', trial_ends_at: null, ai_enabled: true })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('shows nothing when standing is unknown', () => {
    renderBanner('admin', null)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
