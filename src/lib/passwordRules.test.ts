import { describe, it, expect } from 'vitest'
import { validatePassword } from './passwordRules'

describe('validatePassword', () => {
  it('accepts a password with 8+ characters, an uppercase letter, and a number', () => {
    expect(validatePassword('Password1')).toBeNull()
  })

  it('rejects passwords shorter than 8 characters', () => {
    expect(validatePassword('Pass1')).toBe('Password must be at least 8 characters')
  })

  it('accepts exactly 8 characters', () => {
    expect(validatePassword('Passwor1')).toBeNull()
  })

  it('rejects a password with no uppercase letter', () => {
    expect(validatePassword('password1')).toBe('Password must contain an uppercase letter')
  })

  it('rejects a password with no number', () => {
    expect(validatePassword('Passwordd')).toBe('Password must contain a number')
  })

  it('reports length before the other rules', () => {
    expect(validatePassword('abc')).toBe('Password must be at least 8 characters')
  })
})
