import { checkStanding } from '../../supabase/functions/_shared/entitlements'

// What every signed-in user can learn about their organization (migration 013, org_standing()).
export interface Standing {
  subscription_status: string
  trial_ends_at: string | null
  ai_enabled: boolean
}

// Optional: where the "contact us" text points. Set VITE_SUPPORT_EMAIL in Vercel.
export const SUPPORT_EMAIL: string | undefined = import.meta.env.VITE_SUPPORT_EMAIL || undefined

const DAY_MS = 24 * 60 * 60 * 1000
const TRIAL_WARNING_DAYS = 14

/**
 * If the organization may not use the product, why. Uses the same rules as the servers so the
 * screen and the enforcement can't disagree. When standing is unknown (for example the database
 * hasn't been migrated yet) nothing is blocked: the servers fail closed, the screen does not.
 */
export function pausedReason(standing: Standing | null, now: Date = new Date()): string | null {
  if (!standing) return null
  const decision = checkStanding({
    subscription_status: standing.subscription_status,
    trial_ends_at: standing.trial_ends_at,
    max_instructors: null,
    ai_enabled: standing.ai_enabled,
    ai_monthly_token_limit: null
  }, now)
  return decision.ok ? null : decision.error
}

/** Whole days left in a trial, rounded up; null when there is no trial end. Never negative. */
export function trialDaysLeft(trialEndsAt: string | null, now: Date = new Date()): number | null {
  if (!trialEndsAt) return null
  const ms = new Date(trialEndsAt).getTime() - now.getTime()
  return Math.max(0, Math.ceil(ms / DAY_MS))
}

export interface BannerContent {
  tone: 'info' | 'warn'
  text: string
}

/** A banner for admins only; billing details are not for instructors or coordinators. */
export function bannerFor(standing: Standing | null, role: string | undefined, now: Date = new Date()): BannerContent | null {
  if (!standing || role !== 'admin') return null
  if (pausedReason(standing, now)) return null // the paused screen replaces the app

  if (standing.subscription_status === 'past_due') {
    return { tone: 'warn', text: 'Your latest invoice is overdue. Please contact us to avoid an interruption.' }
  }
  if (standing.subscription_status === 'trial') {
    const days = trialDaysLeft(standing.trial_ends_at, now)
    if (days !== null && days <= TRIAL_WARNING_DAYS) {
      return {
        tone: days <= 3 ? 'warn' : 'info',
        text: days === 0
          ? 'Your trial ends today. Contact us to keep CourseSync running.'
          : `Your trial ends in ${days} day${days === 1 ? '' : 's'}. Contact us to keep CourseSync running.`
      }
    }
  }
  return null
}

/** Share of an allowance used, 0..1 (capped); null when the allowance is unlimited. */
export function usageFraction(used: number, limit: number | string | null): number | null {
  if (limit === null) return null
  const max = Number(limit)
  if (!Number.isFinite(max)) return null
  if (max <= 0) return 1
  return Math.min(1, Math.max(0, used / max))
}

export const STATUS_LABELS: Record<string, string> = {
  trial: 'Trial',
  active: 'Active',
  past_due: 'Payment overdue',
  suspended: 'Suspended',
  canceled: 'Canceled'
}
