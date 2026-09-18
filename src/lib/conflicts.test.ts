import { describe, it, expect } from 'vitest'
import { checkAssignmentConflicts, type ConflictCheckInput, type ConflictSectionInfo } from './conflicts'

function section(overrides: Partial<ConflictSectionInfo> = {}): ConflictSectionInfo {
  return {
    id: 'sec-1',
    section_number: '01',
    hours_required: 3,
    day_of_week: 'Monday',
    time_slot: '9:00 AM',
    course: { code: 'CS101' },
    ...overrides
  }
}

function baseInput(overrides: Partial<ConflictCheckInput> = {}): ConflictCheckInput {
  return {
    instructorName: 'Jane Doe',
    targetSection: section(),
    existingAssignments: [],
    unavailableSlots: [],
    hoursAlreadyAssigned: 0,
    maxHoursPerTerm: 40,
    ...overrides
  }
}

describe('checkAssignmentConflicts', () => {
  it('returns no conflicts for a clean assignment', () => {
    expect(checkAssignmentConflicts(baseInput())).toEqual([])
  })

  it('flags a double-booking against an existing assignment at the same day/time', () => {
    const reasons = checkAssignmentConflicts(baseInput({
      existingAssignments: [{
        section_id: 'sec-2',
        section: section({ id: 'sec-2', section_number: '02', course: { code: 'CS201' } })
      }]
    }))
    expect(reasons).toHaveLength(1)
    expect(reasons[0]).toContain('already teaching CS201 Section 02')
  })

  it('does not flag a double-booking against itself (same section id)', () => {
    const reasons = checkAssignmentConflicts(baseInput({
      existingAssignments: [{ section_id: 'sec-1', section: section() }]
    }))
    expect(reasons).toEqual([])
  })

  it('ignores existing assignments at a different day/time', () => {
    const reasons = checkAssignmentConflicts(baseInput({
      existingAssignments: [{
        section_id: 'sec-2',
        section: section({ id: 'sec-2', day_of_week: 'Tuesday' })
      }]
    }))
    expect(reasons).toEqual([])
  })

  it('flags a marked-unavailable slot', () => {
    const reasons = checkAssignmentConflicts(baseInput({
      unavailableSlots: [{ day: 'Monday', time_slot: '9:00 AM' }]
    }))
    expect(reasons).toHaveLength(1)
    expect(reasons[0]).toContain('marked Monday 9:00 AM as unavailable')
  })

  it('flags exceeding remaining hours for the term', () => {
    const reasons = checkAssignmentConflicts(baseInput({
      hoursAlreadyAssigned: 38,
      maxHoursPerTerm: 40,
      targetSection: section({ hours_required: 5 })
    }))
    expect(reasons).toHaveLength(1)
    expect(reasons[0]).toContain('only has 2h remaining')
  })

  it('allows an assignment that exactly uses remaining hours', () => {
    const reasons = checkAssignmentConflicts(baseInput({
      hoursAlreadyAssigned: 37,
      maxHoursPerTerm: 40,
      targetSection: section({ hours_required: 3 })
    }))
    expect(reasons).toEqual([])
  })

  it('skips day/time checks entirely when the section has no schedule yet', () => {
    const reasons = checkAssignmentConflicts(baseInput({
      targetSection: section({ day_of_week: null, time_slot: null }),
      unavailableSlots: [{ day: 'Monday', time_slot: '9:00 AM' }],
      existingAssignments: [{ section_id: 'sec-2', section: section({ id: 'sec-2' }) }]
    }))
    expect(reasons).toEqual([])
  })

  it('accumulates multiple conflict reasons at once', () => {
    const reasons = checkAssignmentConflicts(baseInput({
      unavailableSlots: [{ day: 'Monday', time_slot: '9:00 AM' }],
      hoursAlreadyAssigned: 39,
      maxHoursPerTerm: 40,
      targetSection: section({ hours_required: 3 })
    }))
    expect(reasons).toHaveLength(2)
  })
})
