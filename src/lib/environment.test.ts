import { describe, it, expect } from 'vitest'
import { getEnvironment, APP_VERSION } from './environment'

describe('getEnvironment', () => {
  it('is staging only when VITE_APP_ENV says so', () => {
    expect(getEnvironment('staging', 'production')).toBe('staging')
  })

  it('treats a normal production build with nothing configured as production, so the live site needs no setup', () => {
    expect(getEnvironment(undefined, 'production')).toBe('production')
    expect(getEnvironment('', 'production')).toBe('production')
  })

  it('treats the local dev server as development', () => {
    expect(getEnvironment(undefined, 'development')).toBe('development')
  })

  it('honours an explicit production setting', () => {
    expect(getEnvironment('production', 'development')).toBe('production')
  })

  it('ignores unrecognised values rather than guessing', () => {
    expect(getEnvironment('qa', 'production')).toBe('production')
    expect(getEnvironment('STAGING', 'production')).toBe('production') // exact match only
  })
})

describe('APP_VERSION', () => {
  it('is a short non-empty string (the git commit on Vercel, "dev" locally)', () => {
    expect(typeof APP_VERSION).toBe('string')
    expect(APP_VERSION.length).toBeGreaterThan(0)
    expect(APP_VERSION.length).toBeLessThanOrEqual(7)
  })
})
