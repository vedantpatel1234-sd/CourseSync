// Pure decision logic for plan limits, shared by the Edge Functions (Deno) and the test suite
// (Node). No imports and no I/O on purpose: the functions fetch the facts (billing row, seat
// count, tokens used) and ask these helpers what to do. See docs/phase-2-plan.md.

export interface BillingRow {
  subscription_status: string
  trial_ends_at: string | null
  max_instructors: number | null
  ai_enabled: boolean
  // Postgres bigint can arrive as a string.
  ai_monthly_token_limit: number | string | null
}

export interface Denial {
  ok: false
  status: number
  code: string
  error: string
}

export type Decision = { ok: true } | Denial

const deny = (status: number, code: string, error: string): Denial => ({ ok: false, status, code, error })

/** Is the organization allowed to use the product at all right now? */
export function checkStanding(billing: BillingRow, now: Date = new Date()): Decision {
  switch (billing.subscription_status) {
    case 'active':
    case 'past_due': // grace period: keep working while payment is chased
      return { ok: true }
    case 'trial':
      if (billing.trial_ends_at && new Date(billing.trial_ends_at).getTime() <= now.getTime()) {
        return deny(402, 'trial_expired', 'Your trial has ended. Contact us to continue using CourseSync.')
      }
      return { ok: true }
    case 'suspended':
      return deny(402, 'suspended', 'This account is suspended. Contact us to restore access.')
    case 'canceled':
      return deny(402, 'canceled', 'This subscription has ended. Contact us to renew.')
    default:
      // An unrecognised status must never grant access.
      return deny(402, 'unknown_status', 'This account\'s billing status could not be verified. Contact us.')
  }
}

/** May another instructor account be created? `currentInstructors` is the organization's count. */
export function checkCanAddInstructor(billing: BillingRow, currentInstructors: number, now: Date = new Date()): Decision {
  const standing = checkStanding(billing, now)
  if (!standing.ok) return standing
  if (billing.max_instructors !== null && currentInstructors >= billing.max_instructors) {
    return deny(
      402, 'seat_limit',
      `Your plan includes ${billing.max_instructors} instructor account${billing.max_instructors === 1 ? '' : 's'} and all are in use. Contact us to add more.`
    )
  }
  return { ok: true }
}

/** May an AI request run? `tokensUsedThisMonth` is input + output tokens so far this UTC month. */
export function checkCanUseAi(billing: BillingRow, tokensUsedThisMonth: number, now: Date = new Date()): Decision {
  const standing = checkStanding(billing, now)
  if (!standing.ok) return standing
  if (!billing.ai_enabled) {
    return deny(403, 'ai_disabled', 'AI features are turned off for your organization.')
  }
  if (billing.ai_monthly_token_limit !== null) {
    const limit = Number(billing.ai_monthly_token_limit)
    if (tokensUsedThisMonth >= limit) {
      return deny(429, 'ai_limit_reached', 'Your organization has used its AI allowance for this month. Contact us to increase it.')
    }
  }
  return { ok: true }
}

// The browser used to choose the model and output size freely, so any admin could run the most
// expensive settings. The server now decides. Every model the app uses must be listed here
// (a test fails if src/lib/anthropic.ts drifts from this list).
export const ALLOWED_AI_MODELS: readonly string[] = ['claude-opus-5']
export const MAX_AI_OUTPUT_TOKENS = 8192

export interface AiRequestParams {
  model: string
  max_tokens: number
  system?: unknown
  tools?: unknown
  tool_choice?: unknown
  messages: unknown[]
}

/** Validates an AI request body and returns only the fields we forward, with output size capped. */
export function sanitizeAiRequest(body: unknown): { ok: true; params: AiRequestParams } | Denial {
  const b = (body ?? {}) as Record<string, unknown>
  if (typeof b.model !== 'string' || !ALLOWED_AI_MODELS.includes(b.model)) {
    return deny(400, 'model_not_allowed', 'That model is not available.')
  }
  if (!Array.isArray(b.messages) || b.messages.length === 0) {
    return deny(400, 'bad_request', 'messages is required.')
  }
  const requested = Number(b.max_tokens)
  if (!Number.isFinite(requested) || requested < 1) {
    return deny(400, 'bad_request', 'max_tokens must be a positive number.')
  }
  return {
    ok: true,
    params: {
      model: b.model,
      max_tokens: Math.min(Math.floor(requested), MAX_AI_OUTPUT_TOKENS),
      system: b.system,
      tools: b.tools,
      tool_choice: b.tool_choice,
      messages: b.messages
    }
  }
}
