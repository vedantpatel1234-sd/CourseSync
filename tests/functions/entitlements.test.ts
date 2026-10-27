// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  checkStanding, checkCanAddInstructor, checkCanUseAi, sanitizeAiRequest,
  ALLOWED_AI_MODELS, MAX_AI_OUTPUT_TOKENS, type BillingRow
} from '../../supabase/functions/_shared/entitlements'

vi.mock('../../src/lib/supabase', () => ({ supabase: {} }))

const NOW = new Date('2026-11-15T12:00:00Z')
const DAY = 24 * 60 * 60 * 1000

const billing = (over: Partial<BillingRow> = {}): BillingRow => ({
  subscription_status: 'active',
  trial_ends_at: null,
  max_instructors: 25,
  ai_enabled: true,
  ai_monthly_token_limit: 1_000_000,
  ...over
})

describe('checkStanding', () => {
  it.each(['active', 'past_due'])('allows a %s account', status => {
    expect(checkStanding(billing({ subscription_status: status }), NOW)).toEqual({ ok: true })
  })

  it('allows a trial that has not ended', () => {
    const trial = billing({ subscription_status: 'trial', trial_ends_at: new Date(NOW.getTime() + DAY).toISOString() })
    expect(checkStanding(trial, NOW)).toEqual({ ok: true })
  })

  it('allows a trial with no end date', () => {
    expect(checkStanding(billing({ subscription_status: 'trial', trial_ends_at: null }), NOW)).toEqual({ ok: true })
  })

  it('blocks a trial the moment it ends (no scheduled job needed)', () => {
    const atEnd = billing({ subscription_status: 'trial', trial_ends_at: NOW.toISOString() })
    expect(checkStanding(atEnd, NOW)).toMatchObject({ ok: false, status: 402, code: 'trial_expired' })
    const past = billing({ subscription_status: 'trial', trial_ends_at: new Date(NOW.getTime() - DAY).toISOString() })
    expect(checkStanding(past, NOW)).toMatchObject({ ok: false, code: 'trial_expired' })
  })

  it.each([['suspended', 'suspended'], ['canceled', 'canceled']])('blocks a %s account', (status, code) => {
    expect(checkStanding(billing({ subscription_status: status }), NOW)).toMatchObject({ ok: false, status: 402, code })
  })

  it('never grants access for a status it does not recognise', () => {
    expect(checkStanding(billing({ subscription_status: 'free-for-all' }), NOW)).toMatchObject({ ok: false, code: 'unknown_status' })
    expect(checkStanding(billing({ subscription_status: '' }), NOW)).toMatchObject({ ok: false })
  })
})

describe('checkCanAddInstructor', () => {
  it('allows adding while under the limit', () => {
    expect(checkCanAddInstructor(billing({ max_instructors: 25 }), 24, NOW)).toEqual({ ok: true })
  })

  it('blocks at the limit, and says how many the plan includes', () => {
    const result = checkCanAddInstructor(billing({ max_instructors: 25 }), 25, NOW)
    expect(result).toMatchObject({ ok: false, status: 402, code: 'seat_limit' })
    expect(result.ok === false && result.error).toContain('25 instructor accounts')
  })

  it('blocks above the limit (e.g. after the plan was reduced)', () => {
    expect(checkCanAddInstructor(billing({ max_instructors: 5 }), 9, NOW)).toMatchObject({ ok: false, code: 'seat_limit' })
  })

  it('treats a null limit as unlimited', () => {
    expect(checkCanAddInstructor(billing({ max_instructors: null }), 10_000, NOW)).toEqual({ ok: true })
  })

  it('uses the singular for a one-seat plan', () => {
    const result = checkCanAddInstructor(billing({ max_instructors: 1 }), 1, NOW)
    expect(result.ok === false && result.error).toContain('1 instructor account ')
  })

  it('checks standing before seats', () => {
    expect(checkCanAddInstructor(billing({ subscription_status: 'suspended', max_instructors: 100 }), 0, NOW))
      .toMatchObject({ ok: false, code: 'suspended' })
  })
})

describe('checkCanUseAi', () => {
  it('allows use under the monthly limit', () => {
    expect(checkCanUseAi(billing(), 999_999, NOW)).toEqual({ ok: true })
  })

  it('blocks exactly at the limit', () => {
    expect(checkCanUseAi(billing(), 1_000_000, NOW)).toMatchObject({ ok: false, status: 429, code: 'ai_limit_reached' })
  })

  it('accepts a limit that arrives as a string (Postgres bigint)', () => {
    expect(checkCanUseAi(billing({ ai_monthly_token_limit: '500' }), 499, NOW)).toEqual({ ok: true })
    expect(checkCanUseAi(billing({ ai_monthly_token_limit: '500' }), 500, NOW)).toMatchObject({ ok: false, code: 'ai_limit_reached' })
  })

  it('treats a null limit as unlimited', () => {
    expect(checkCanUseAi(billing({ ai_monthly_token_limit: null }), 9e12, NOW)).toEqual({ ok: true })
  })

  it('honours a limit of zero', () => {
    expect(checkCanUseAi(billing({ ai_monthly_token_limit: 0 }), 0, NOW)).toMatchObject({ ok: false, code: 'ai_limit_reached' })
  })

  it('blocks when AI is switched off for the organization', () => {
    expect(checkCanUseAi(billing({ ai_enabled: false }), 0, NOW)).toMatchObject({ ok: false, status: 403, code: 'ai_disabled' })
  })

  it('blocks AI for an account that is not in good standing, before looking at usage', () => {
    expect(checkCanUseAi(billing({ subscription_status: 'canceled' }), 0, NOW)).toMatchObject({ ok: false, code: 'canceled' })
  })
})

describe('sanitizeAiRequest', () => {
  const valid = () => ({
    model: ALLOWED_AI_MODELS[0], max_tokens: 1024, system: 'be brief',
    tools: [{ name: 't' }], tool_choice: { type: 'auto' }, messages: [{ role: 'user', content: 'hi' }]
  })

  it('passes a valid request through unchanged', () => {
    const result = sanitizeAiRequest(valid())
    expect(result).toEqual({ ok: true, params: valid() })
  })

  it('rejects a model that is not on the allow-list', () => {
    expect(sanitizeAiRequest({ ...valid(), model: 'some-expensive-model' })).toMatchObject({ ok: false, status: 400, code: 'model_not_allowed' })
    expect(sanitizeAiRequest({ ...valid(), model: undefined })).toMatchObject({ ok: false, code: 'model_not_allowed' })
  })

  it('caps max_tokens at the server limit instead of trusting the browser', () => {
    const result = sanitizeAiRequest({ ...valid(), max_tokens: 1_000_000 })
    expect(result.ok && result.params.max_tokens).toBe(MAX_AI_OUTPUT_TOKENS)
  })

  it('rounds fractional max_tokens down', () => {
    const result = sanitizeAiRequest({ ...valid(), max_tokens: 100.9 })
    expect(result.ok && result.params.max_tokens).toBe(100)
  })

  it.each([0, -5, NaN, 'lots', null, undefined])('rejects max_tokens of %s', bad => {
    expect(sanitizeAiRequest({ ...valid(), max_tokens: bad })).toMatchObject({ ok: false, status: 400 })
  })

  it('rejects missing or empty messages', () => {
    expect(sanitizeAiRequest({ ...valid(), messages: [] })).toMatchObject({ ok: false, code: 'bad_request' })
    expect(sanitizeAiRequest({ ...valid(), messages: undefined })).toMatchObject({ ok: false, code: 'bad_request' })
    expect(sanitizeAiRequest(undefined)).toMatchObject({ ok: false })
  })

  it('forwards only the known fields', () => {
    const result = sanitizeAiRequest({ ...valid(), stream: true, metadata: { user_id: 'x' }, anything: 1 })
    expect(result.ok && Object.keys(result.params).sort()).toEqual(
      ['max_tokens', 'messages', 'model', 'system', 'tool_choice', 'tools'])
  })
})

describe('the app and the server agree on what is allowed', () => {
  it('every model the app sends is on the allow-list', async () => {
    const { COPILOT_MODEL } = await import('../../src/lib/anthropic')
    expect(ALLOWED_AI_MODELS).toContain(COPILOT_MODEL)
  })

  it('no call site asks for more output than the server will allow', () => {
    const root = join(__dirname, '..', '..', 'src')
    const files = [
      ...readdirSync(join(root, 'lib')).filter(f => f.endsWith('.ts') && !f.includes('.test.')).map(f => join(root, 'lib', f)),
      join(root, 'pages', 'admin', 'AI.tsx')
    ]
    const found: number[] = []
    for (const file of files) {
      for (const m of readFileSync(file, 'utf8').matchAll(/max_tokens:\s*(\d+)/g)) found.push(Number(m[1]))
    }
    expect(found.length).toBeGreaterThan(0)
    expect(Math.max(...found)).toBeLessThanOrEqual(MAX_AI_OUTPUT_TOKENS)
  })
})
