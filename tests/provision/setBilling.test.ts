// @vitest-environment node
import { describe, it, expect } from 'vitest'
// @ts-expect-error - plain ES module script, no type declarations
import { buildBillingPatch, STATUSES } from '../../scripts/setBilling.mjs'

const NOW = new Date('2026-11-01T00:00:00Z')

describe('buildBillingPatch', () => {
  it('builds a patch containing only what was given', () => {
    expect(buildBillingPatch({ plan: ' standard ', status: 'active' }, NOW)).toEqual({
      plan: 'standard', subscription_status: 'active'
    })
  })

  it('parses numeric limits and treats "unlimited" as no limit', () => {
    expect(buildBillingPatch({ 'max-instructors': '120', 'ai-limit': '5000000' }, NOW)).toEqual({
      max_instructors: 120, ai_monthly_token_limit: 5_000_000
    })
    expect(buildBillingPatch({ 'max-instructors': 'unlimited', 'ai-limit': 'unlimited' }, NOW)).toEqual({
      max_instructors: null, ai_monthly_token_limit: null
    })
  })

  it('accepts zero as a limit (it means "none", not "unlimited")', () => {
    expect(buildBillingPatch({ 'ai-limit': '0' }, NOW)).toEqual({ ai_monthly_token_limit: 0 })
  })

  it.each(['12.5', '-3', 'lots', ''])('rejects the limit %j', bad => {
    expect(() => buildBillingPatch({ 'max-instructors': bad }, NOW)).toThrow(/whole number/)
  })

  it.each(STATUSES)('accepts the status %s', status => {
    expect(buildBillingPatch({ status }, NOW)).toEqual({ subscription_status: status })
  })

  it('rejects an unknown status, naming the valid ones', () => {
    expect(() => buildBillingPatch({ status: 'free' }, NOW)).toThrow(/must be one of: trial, active/)
  })

  it('switches AI on and off', () => {
    expect(buildBillingPatch({ ai: 'off' }, NOW)).toEqual({ ai_enabled: false })
    expect(buildBillingPatch({ ai: 'on' }, NOW)).toEqual({ ai_enabled: true })
    expect(() => buildBillingPatch({ ai: 'maybe' }, NOW)).toThrow(/"on" or "off"/)
  })

  it('sets the trial end a number of days from now', () => {
    expect(buildBillingPatch({ 'trial-days': '30' }, NOW)).toEqual({ trial_ends_at: '2026-12-01T00:00:00.000Z' })
    expect(() => buildBillingPatch({ 'trial-days': '-1' }, NOW)).toThrow(/whole number/)
  })

  it('records a signed agreement only when version, date and signer are all given', () => {
    expect(buildBillingPatch({
      'msa-version': '2026-11-01', 'msa-signed-at': '2026-11-02', 'msa-signed-by': 'Dana Lee'
    }, NOW)).toEqual({
      msa_version: '2026-11-01', msa_signed_at: '2026-11-02T00:00:00.000Z', msa_signed_by: 'Dana Lee'
    })
    expect(() => buildBillingPatch({ 'msa-version': '2026-11-01' }, NOW)).toThrow(/given together/)
  })

  it.each(['2026-13-45', '11/02/2026', 'yesterday'])('rejects the agreement date %j', bad => {
    expect(() => buildBillingPatch({ 'msa-version': 'v', 'msa-signed-at': bad, 'msa-signed-by': 'x' }, NOW))
      .toThrow(/date like 2026-11-02/)
  })

  it('refuses to run with nothing to change, and rejects an empty plan', () => {
    expect(() => buildBillingPatch({}, NOW)).toThrow(/Nothing to change/)
    expect(() => buildBillingPatch({ plan: '  ' }, NOW)).toThrow(/plan cannot be empty/)
  })
})
