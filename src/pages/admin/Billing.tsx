import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../stores/authStore'
import { SUPPORT_EMAIL, STATUS_LABELS, trialDaysLeft, usageFraction } from '../../lib/billing'

interface BillingRow {
  plan: string
  subscription_status: string
  trial_ends_at: string | null
  max_instructors: number | null
  ai_enabled: boolean
  ai_monthly_token_limit: number | string | null
  msa_version: string | null
  msa_signed_at: string | null
  msa_signed_by: string | null
}

const card = {
  background: 'white', borderRadius: 14, padding: 24, marginBottom: 20,
  border: '1px solid rgba(0,0,0,0.06)', boxShadow: 'var(--shadow-card)'
} as const

const STATUS_COLORS: Record<string, { color: string; bg: string }> = {
  trial: { color: '#534AB7', bg: '#EEEDFE' },
  active: { color: '#0F6E56', bg: '#EAF3DE' },
  past_due: { color: '#854F0B', bg: '#FAEEDA' },
  suspended: { color: '#A32D2D', bg: '#FCEBEB' },
  canceled: { color: '#6B6B80', bg: '#f3f4f6' }
}

function Meter({ label, used, limit, unit }: { label: string; used: number; limit: number | string | null; unit: string }) {
  const fraction = usageFraction(used, limit)
  const high = fraction !== null && fraction >= 0.9
  return (
    <div style={{ marginBottom: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, marginBottom: 8 }}>
        <span style={{ color: '#1A1A2E', fontWeight: 500 }}>{label}</span>
        <span style={{ color: '#6B6B80' }}>
          {used.toLocaleString()} of {limit === null ? 'unlimited' : Number(limit).toLocaleString()} {unit}
        </span>
      </div>
      {fraction !== null && (
        <div role="progressbar" aria-label={label} aria-valuenow={Math.round(fraction * 100)} aria-valuemin={0} aria-valuemax={100}
          style={{ height: 8, borderRadius: 4, background: '#f0f0f0', overflow: 'hidden' }}>
          <div style={{ width: `${fraction * 100}%`, height: '100%', background: high ? '#A32D2D' : '#534AB7' }} />
        </div>
      )}
    </div>
  )
}

export default function AdminBilling() {
  const { user } = useAuthStore()
  const [loading, setLoading] = useState(true)
  const [billing, setBilling] = useState<BillingRow | null>(null)
  const [seats, setSeats] = useState(0)
  const [tokensUsed, setTokensUsed] = useState(0)

  useEffect(() => {
    let active = true
    const load = async () => {
      const [billingRes, seatsRes, usedRes] = await Promise.all([
        supabase.from('organization_billing').select('*').maybeSingle(),
        supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'instructor'),
        user?.organization_id
          ? supabase.rpc('ai_tokens_used_this_month', { p_org: user.organization_id })
          : Promise.resolve({ data: 0, error: null })
      ])
      if (!active) return
      setBilling(billingRes.error ? null : (billingRes.data as BillingRow | null))
      setSeats(seatsRes.count ?? 0)
      setTokensUsed(Number(usedRes.data ?? 0))
      setLoading(false)
    }
    load()
    return () => { active = false }
  }, [user?.organization_id])

  if (loading) {
    return <div style={{ padding: 32, fontFamily: 'DM Sans, sans-serif', color: '#6B6B80' }}>Loading...</div>
  }

  const contact = SUPPORT_EMAIL
    ? <a href={`mailto:${SUPPORT_EMAIL}`} style={{ color: '#534AB7' }}>{SUPPORT_EMAIL}</a>
    : 'us'

  return (
    <div style={{ padding: 32, fontFamily: 'DM Sans, sans-serif', maxWidth: 720 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1A1A2E', marginBottom: 4 }}>Billing & usage</h1>
      <p style={{ fontSize: 14, color: '#6B6B80', marginBottom: 28 }}>
        Your plan, what it includes, and how much of it you have used
      </p>

      {!billing ? (
        <div style={card}>
          <p style={{ fontSize: 14, color: '#6B6B80' }}>
            Billing details aren't available for your organization yet. Contact {contact} if this looks wrong.
          </p>
        </div>
      ) : (
        <>
          <div style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 12, color: '#6B6B80', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>Plan</div>
                <div style={{ fontSize: 18, fontWeight: 600, color: '#1A1A2E', textTransform: 'capitalize' }}>{billing.plan}</div>
              </div>
              <span style={{
                padding: '5px 14px', borderRadius: 20, fontSize: 13, fontWeight: 600,
                ...(STATUS_COLORS[billing.subscription_status] ?? STATUS_COLORS.canceled)
              }}>
                {STATUS_LABELS[billing.subscription_status] ?? billing.subscription_status}
              </span>
            </div>
            {billing.subscription_status === 'trial' && billing.trial_ends_at && (
              <p style={{ fontSize: 14, color: '#6B6B80' }}>
                Trial ends {new Date(billing.trial_ends_at).toLocaleDateString()} ({trialDaysLeft(billing.trial_ends_at)} days left).
              </p>
            )}
          </div>

          <div style={card}>
            <h2 style={{ fontSize: 16, fontWeight: 600, color: '#1A1A2E', marginBottom: 16 }}>Included in your plan</h2>
            <div style={{ display: 'grid', gap: 20 }}>
              <Meter label="Instructor accounts" used={seats} limit={billing.max_instructors} unit="accounts" />
              {billing.ai_enabled ? (
                <Meter label="AI allowance this month" used={tokensUsed} limit={billing.ai_monthly_token_limit} unit="tokens" />
              ) : (
                <p style={{ fontSize: 14, color: '#6B6B80' }}>AI features are turned off for your organization.</p>
              )}
            </div>
          </div>

          <div style={card}>
            <h2 style={{ fontSize: 16, fontWeight: 600, color: '#1A1A2E', marginBottom: 12 }}>Agreement</h2>
            {billing.msa_signed_at ? (
              <p style={{ fontSize: 14, color: '#6B6B80' }}>
                Version {billing.msa_version} signed by {billing.msa_signed_by} on {new Date(billing.msa_signed_at).toLocaleDateString()}.
              </p>
            ) : (
              <p style={{ fontSize: 14, color: '#6B6B80' }}>No signed agreement is on file yet.</p>
            )}
          </div>
        </>
      )}

      <p style={{ fontSize: 13, color: '#6B6B80' }}>
        To change your plan, add instructor accounts, or ask about an invoice, contact {contact}.
      </p>
    </div>
  )
}
