import { describe, it, expect } from 'vitest'
import { formatDayTime, DAYS, TIME_SLOTS } from './schedule'

describe('formatDayTime', () => {
  it('joins a day and time slot', () => {
    expect(formatDayTime('Monday', '9:00 AM')).toBe('Monday 9:00 AM')
  })

  it('returns a placeholder when day is missing', () => {
    expect(formatDayTime(null, '9:00 AM')).toBe('Not scheduled')
  })

  it('returns a placeholder when time slot is missing', () => {
    expect(formatDayTime('Monday', null)).toBe('Not scheduled')
  })

  it('returns a placeholder when both are missing or undefined', () => {
    expect(formatDayTime(undefined, undefined)).toBe('Not scheduled')
    expect(formatDayTime('', '')).toBe('Not scheduled')
  })
})

describe('DAYS and TIME_SLOTS', () => {
  it('has no duplicate days', () => {
    expect(new Set(DAYS).size).toBe(DAYS.length)
  })

  it('has no duplicate time slots', () => {
    expect(new Set(TIME_SLOTS).size).toBe(TIME_SLOTS.length)
  })
})
