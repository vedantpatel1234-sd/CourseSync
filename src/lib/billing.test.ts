import { describe, it, expect } from 'vitest'
import { pausedReason, trialDaysLeft, bannerFor, usageFraction, type Standing } from './billing'

const NOW = new Date('2026-11-15T12:00:00Z')
const DAY = 24 * 60 * 60 * 1000
const inDays = (n: number) => new Date(NOW.getTime() + n * DAY).toISOString()

const standing = (over: Partial<Standing> = {}): Standing => ({
  subscription_status: 'active', trial_ends_at: null, ai_enabled: true, ...over
})

describe('pausedReason', () => {
  it('does not block when standing is unknown (e.g. database not yet migrated)', () => {
    expect(pausedReason(null, NOW)).toBeNull()
  })

  it.each(['active', 'past_due'])('does not block a %s account', status => {
    expect(pausedReason(standing({ subscription_status: status }), NOW)).toBeNull()
  })

  it('blocks suspended and canceled accounts with an explanation', () => {
    expect(pausedReason(standing({ subscription_status: 'suspended' }), NOW)).toMatch(/suspended/i)
    expect(pausedReason(standing({ subscription_status: 'canceled' }), NOW)).toMatch(/ended/i)
  })

  it('blocks a trial that has ended but not one that is running', () => {
    expect(pausedReason(standing({ subscription_status: 'trial', trial_ends_at: inDays(-1) }), NOW)).toMatch(/trial has ended/i)
    expect(pausedReason(standing({ subscription_status: 'trial', trial_ends_at: inDays(5) }), NOW)).toBeNull()
  })
})

describe('trialDaysLeft', () => {
  it('rounds partial days up so "ends in 0 days" only happens on the day itself', () => {
    expect(trialDaysLeft(inDays(5), NOW)).toBe(5)
    expect(trialDaysLeft(new Date(NOW.getTime() + 0.2 * DAY).toISOString(), NOW)).toBe(1)
  })

  it('never goes negative and returns null with no trial end', () => {
    expect(trialDaysLeft(inDays(-9), NOW)).toBe(0)
    expect(trialDaysLeft(null, NOW)).toBeNull()
  })
})

describe('bannerFor', () => {
  const trial = (days: number) => standing({ subscription_status: 'trial', trial_ends_at: inDays(days) })

  it('shows nothing to instructors or coordinators, whatever the status', () => {
    expect(bannerFor(trial(2), 'instructor', NOW)).toBeNull()
    expect(bannerFor(standing({ subscription_status: 'past_due' }), 'coordinator', NOW)).toBeNull()
  })

  it('shows nothing when standing is unknown or the account is healthy', () => {
    expect(bannerFor(null, 'admin', NOW)).toBeNull()
    expect(bannerFor(standing(), 'admin', NOW)).toBeNull()
  })

  it('warns an admin of an overdue invoice', () => {
    expect(bannerFor(standing({ subscription_status: 'past_due' }), 'admin', NOW)).toMatchObject({ tone: 'warn', text: expect.stringMatching(/overdue/i) })
  })

  it('stays quiet early in a trial, then counts down', () => {
    expect(bannerFor(trial(20), 'admin', NOW)).toBeNull()
    expect(bannerFor(trial(14), 'admin', NOW)).toMatchObject({ tone: 'info', text: 'Your trial ends in 14 days. Contact us to keep CourseSync running.' })
    expect(bannerFor(trial(3), 'admin', NOW)).toMatchObject({ tone: 'warn' })
  })

  it('uses the singular for one day and a special message on the last day', () => {
    expect(bannerFor(trial(1), 'admin', NOW)?.text).toContain('1 day.')
    const lastDay = standing({ subscription_status: 'trial', trial_ends_at: new Date(NOW.getTime()).toISOString() })
    expect(bannerFor(lastDay, 'admin', NOW)).toBeNull() // already ended -> paused screen, not a banner
  })

  it('shows no banner once the account is paused (the paused screen takes over)', () => {
    expect(bannerFor(standing({ subscription_status: 'suspended' }), 'admin', NOW)).toBeNull()
    expect(bannerFor(trial(-1), 'admin', NOW)).toBeNull()
  })
})

describe('usageFraction', () => {
  it('returns the share used, capped at 1', () => {
    expect(usageFraction(250, 1000)).toBe(0.25)
    expect(usageFraction(5000, 1000)).toBe(1)
  })

  it('accepts a limit that arrives as a string', () => {
    expect(usageFraction(500, '1000')).toBe(0.5)
  })

  it('returns null for an unlimited allowance', () => {
    expect(usageFraction(123, null)).toBeNull()
  })

  it('treats a zero allowance as fully used', () => {
    expect(usageFraction(0, 0)).toBe(1)
  })
})
