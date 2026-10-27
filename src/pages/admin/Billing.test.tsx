import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import AdminBilling from './Billing'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../stores/authStore'

vi.mock('../../lib/supabase', () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }))
vi.mock('../../stores/authStore', () => ({ useAuthStore: vi.fn() }))

const ADMIN = { id: 'u1', full_name: 'Ada', email: 'a@x.com', role: 'admin' as const, organization_id: 'org-1' }

const BILLING = {
  plan: 'standard', subscription_status: 'active', trial_ends_at: null,
  max_instructors: 25, ai_enabled: true, ai_monthly_token_limit: 1_000_000,
  msa_version: '2026-11-01', msa_signed_at: '2026-11-02T00:00:00Z', msa_signed_by: 'Dana Lee'
}

// from('organization_billing').select('*').maybeSingle()  and
// from('profiles').select('id', {count, head}).eq('role', 'instructor')
function mockData(opts: { billing?: unknown; billingError?: boolean; seats?: number; tokens?: number }) {
  vi.mocked(supabase.from).mockImplementation(((table: string) => {
    if (table === 'organization_billing') {
      return { select: () => ({ maybeSingle: async () => (
        opts.billingError ? { data: null, error: { message: 'relation does not exist' } } : { data: opts.billing ?? null, error: null }) }) }
    }
    return { select: () => ({ eq: async () => ({ count: opts.seats ?? 0, error: null }) }) }
  }) as never)
  vi.mocked(supabase.rpc).mockResolvedValue({ data: opts.tokens ?? 0, error: null } as never)
}

describe('AdminBilling', () => {
  beforeEach(() => {
    vi.mocked(useAuthStore).mockReturnValue({ user: ADMIN } as never)
  })

  it('shows the plan, status, seat usage and AI usage against the limits', async () => {
    mockData({ billing: BILLING, seats: 12, tokens: 250_000 })
    render(<AdminBilling />)

    expect(await screen.findByText('standard')).toBeInTheDocument()
    expect(screen.getByText('Active')).toBeInTheDocument()
    expect(screen.getByText('12 of 25 accounts')).toBeInTheDocument()
    expect(screen.getByText('250,000 of 1,000,000 tokens')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Instructor accounts' })).toHaveAttribute('aria-valuenow', '48')
    expect(screen.getByRole('progressbar', { name: 'AI allowance this month' })).toHaveAttribute('aria-valuenow', '25')
    expect(supabase.rpc).toHaveBeenCalledWith('ai_tokens_used_this_month', { p_org: 'org-1' })
  })

  it('shows unlimited allowances without a progress bar', async () => {
    mockData({ billing: { ...BILLING, max_instructors: null, ai_monthly_token_limit: null }, seats: 3, tokens: 10 })
    render(<AdminBilling />)

    expect(await screen.findByText('3 of unlimited accounts')).toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('shows the trial end date for a trial', async () => {
    mockData({ billing: { ...BILLING, plan: 'trial', subscription_status: 'trial', trial_ends_at: new Date(Date.now() + 9 * 86_400_000).toISOString() } })
    render(<AdminBilling />)

    expect(await screen.findByText('Trial')).toBeInTheDocument()
    expect(screen.getByText(/Trial ends .* \(9 days left\)/)).toBeInTheDocument()
  })

  it('says so when AI is turned off instead of showing an allowance', async () => {
    mockData({ billing: { ...BILLING, ai_enabled: false } })
    render(<AdminBilling />)

    expect(await screen.findByText('AI features are turned off for your organization.')).toBeInTheDocument()
    expect(screen.queryByRole('progressbar', { name: 'AI allowance this month' })).not.toBeInTheDocument()
  })

  it('shows the signed agreement, or that none is on file', async () => {
    mockData({ billing: BILLING })
    const { unmount } = render(<AdminBilling />)
    expect(await screen.findByText(/Version 2026-11-01 signed by Dana Lee/)).toBeInTheDocument()
    unmount()

    mockData({ billing: { ...BILLING, msa_signed_at: null, msa_version: null, msa_signed_by: null } })
    render(<AdminBilling />)
    expect(await screen.findByText('No signed agreement is on file yet.')).toBeInTheDocument()
  })

  it('degrades gracefully when billing is not available (database not yet migrated)', async () => {
    mockData({ billingError: true })
    render(<AdminBilling />)

    expect(await screen.findByText(/Billing details aren't available for your organization yet/)).toBeInTheDocument()
    expect(screen.queryByText('Included in your plan')).not.toBeInTheDocument()
  })
})
