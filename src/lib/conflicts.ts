export interface ConflictSectionInfo {
  id: string
  section_number: string
  hours_required: number
  day_of_week: string | null
  time_slot: string | null
  course: { code: string }
}

export interface ExistingAssignmentInfo {
  section_id: string
  section: ConflictSectionInfo
}

export interface UnavailableSlot {
  day: string
  time_slot: string
}

export interface ConflictCheckInput {
  instructorName: string
  targetSection: ConflictSectionInfo
  existingAssignments: ExistingAssignmentInfo[]
  unavailableSlots: UnavailableSlot[]
  hoursAlreadyAssigned: number
  maxHoursPerTerm: number
}

/**
 * Returns a list of plain-English reasons an instructor cannot be assigned to
 * targetSection. An empty array means no conflicts. Used identically by the
 * manual Assignments page and the Matching Engine so both enforce the same rules.
 */
export function checkAssignmentConflicts(input: ConflictCheckInput): string[] {
  const { instructorName, targetSection, existingAssignments, unavailableSlots, hoursAlreadyAssigned, maxHoursPerTerm } = input
  const reasons: string[] = []

  if (targetSection.day_of_week && targetSection.time_slot) {
    const doubleBooked = existingAssignments.find(a =>
      a.section_id !== targetSection.id &&
      a.section.day_of_week === targetSection.day_of_week &&
      a.section.time_slot === targetSection.time_slot
    )
    if (doubleBooked) {
      reasons.push(
        `Blocked: ${instructorName} is already teaching ${doubleBooked.section.course.code} Section ${doubleBooked.section.section_number} on ${targetSection.day_of_week} ${targetSection.time_slot}`
      )
    }

    const unavailable = unavailableSlots.find(u =>
      u.day === targetSection.day_of_week && u.time_slot === targetSection.time_slot
    )
    if (unavailable) {
      reasons.push(
        `Blocked: ${instructorName} has marked ${targetSection.day_of_week} ${targetSection.time_slot} as unavailable`
      )
    }
  }

  const remaining = maxHoursPerTerm - hoursAlreadyAssigned
  if (remaining < targetSection.hours_required) {
    reasons.push(
      `Blocked: ${instructorName} only has ${remaining}h remaining this term but ${targetSection.course.code} Section ${targetSection.section_number} needs ${targetSection.hours_required}h`
    )
  }

  return reasons
}
