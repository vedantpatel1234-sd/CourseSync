import type Anthropic from '@anthropic-ai/sdk'
import { createMessage, COPILOT_MODEL } from './anthropic'
import { supabase } from './supabase'
import { formatDayTime } from './schedule'
import { checkAssignmentConflicts, type ExistingAssignmentInfo, type UnavailableSlot } from './conflicts'

interface RawSection {
  id: string
  section_number: string
  hours_required: number
  status: string
  day_of_week: string | null
  time_slot: string | null
  course_id: string
  course: { code: string; name: string }
}

interface RawInstructor {
  id: string
  full_name: string
  instructor_profiles: { max_hours_per_term: number } | null
}

interface RawAssignment {
  instructor_id: string
  hours_assigned: number
  section_id: string
  section: {
    id: string
    section_number: string
    hours_required: number
    day_of_week: string | null
    time_slot: string | null
    course: { code: string }
  }
}

interface RawAvailability {
  instructor_id: string
  day: string
  time_slot: string
}

interface RawQualification {
  instructor_id: string
  course_id: string
}

interface RawPreference {
  instructor_id: string
  section_id: string
  rank: number
}

interface InstructorState {
  id: string
  full_name: string
  hoursAssigned: number
  maxHours: number
}

export interface AcceptedItem {
  sectionId: string
  instructorId: string
  hours: number
  sectionLabel: string
  instructorName: string
  dayTime: string
  rationale: string
}

export interface RejectedItem {
  sectionLabel: string
  reason: string
}

export interface AutoScheduleResult {
  accepted: AcceptedItem[]
  rejected: RejectedItem[]
  noSectionsFound: boolean
}

const SCHEDULE_TOOL: Anthropic.Tool = {
  name: 'submit_schedule_plan',
  description: 'Submit the complete proposed schedule: an assignment for every section you could confidently fill, and a reason for every section you could not.',
  input_schema: {
    type: 'object',
    properties: {
      assignments: {
        type: 'array',
        description: 'Proposed instructor assignments. Every section_id and instructor_id must be exact ids from the data provided — never invent one.',
        items: {
          type: 'object',
          properties: {
            section_id: { type: 'string' },
            instructor_id: { type: 'string' },
            rationale: { type: 'string', description: 'One short plain-English sentence explaining why this instructor was picked for this section.' }
          },
          required: ['section_id', 'instructor_id', 'rationale']
        }
      },
      unassignable: {
        type: 'array',
        description: 'Sections you could not confidently assign to anyone, with why.',
        items: {
          type: 'object',
          properties: {
            section_id: { type: 'string' },
            reason: { type: 'string' }
          },
          required: ['section_id', 'reason']
        }
      }
    },
    required: ['assignments', 'unassignable']
  }
}

const SYSTEM_PROMPT = `You are a course-scheduling planner. You will be given every unassigned section for a term, every instructor's remaining hours, which instructors are verified-qualified for which courses, which day/time slots each instructor has marked unavailable, and instructor preference rankings for specific sections (rank 1 = most preferred).

Build the best possible full schedule:
- Only propose an instructor who is qualified for the course, if any qualified instructor is listed. If none are listed as qualified for a course, you may propose an unqualified instructor if hours and availability work, but say so in the rationale.
- Never propose an instructor for a section that conflicts with their marked-unavailable slots, or that would push them over their max hours for the term.
- Never propose the same instructor for two sections that share the same day and time slot.
- Prefer instructors with higher preference rank (1 is best) for a given section when qualification and availability are otherwise equal.
- Try to distribute hours reasonably across instructors rather than loading up one person, when multiple qualified+available candidates exist.
- Every section_id and instructor_id you use must be an exact id from the data given to you — never invent or guess one.
- Every section must appear exactly once, either in "assignments" or in "unassignable" (with a real reason), never both, never omitted.

Call submit_schedule_plan exactly once with your complete plan.`

async function fetchSections(termId: string): Promise<RawSection[]> {
  const { data } = await supabase
    .from('sections')
    .select('*, course:courses(code, name)')
    .eq('term_id', termId)
    .eq('status', 'unassigned')
  return (data || []) as RawSection[]
}

async function fetchInstructors(): Promise<RawInstructor[]> {
  const { data } = await supabase
    .from('profiles')
    .select('*, instructor_profiles(*)')
    .eq('role', 'instructor')
    .order('full_name')
  return (data || []) as RawInstructor[]
}

async function fetchLiveAssignments(): Promise<RawAssignment[]> {
  const { data } = await supabase
    .from('assignments')
    .select('instructor_id, hours_assigned, section_id, section:sections!assignments_section_id_fkey(id, section_number, hours_required, day_of_week, time_slot, course:courses(code))')
    .is('draft_id', null)
    .neq('status', 'rejected')
  return (data || []) as unknown as RawAssignment[]
}

async function fetchAvailability(): Promise<RawAvailability[]> {
  const { data } = await supabase.from('instructor_availability').select('instructor_id, day, time_slot')
  return (data || []) as RawAvailability[]
}

async function fetchQualifications(): Promise<RawQualification[]> {
  const { data } = await supabase.from('qualifications').select('instructor_id, course_id').eq('verified', true)
  return (data || []) as RawQualification[]
}

async function fetchPreferences(): Promise<RawPreference[]> {
  const { data } = await supabase.from('preferences').select('instructor_id, section_id, rank')
  return (data || []) as RawPreference[]
}

function toConflictAssignments(assignments: RawAssignment[]): ExistingAssignmentInfo[] {
  return assignments.map(a => ({ section_id: a.section_id, section: a.section }))
}

function toConflictAvailability(availability: RawAvailability[]): UnavailableSlot[] {
  return availability.map(a => ({ day: a.day, time_slot: a.time_slot }))
}

export async function runAutoScheduler(termId: string): Promise<AutoScheduleResult> {
  const [sections, instructors, liveAssignments, availability, qualifications, preferences] = await Promise.all([
    fetchSections(termId), fetchInstructors(), fetchLiveAssignments(), fetchAvailability(), fetchQualifications(), fetchPreferences()
  ])

  if (sections.length === 0) {
    return { accepted: [], rejected: [], noSectionsFound: true }
  }

  const instructorState = new Map<string, InstructorState>(
    instructors.map(p => [p.id, {
      id: p.id,
      full_name: p.full_name,
      hoursAssigned: liveAssignments
        .filter(a => a.instructor_id === p.id)
        .reduce((sum, a) => sum + a.hours_assigned, 0),
      maxHours: p.instructor_profiles?.max_hours_per_term || 40
    }])
  )

  const payload = {
    sections: sections.map(s => ({
      id: s.id,
      course_code: s.course.code,
      course_name: s.course.name,
      section_number: s.section_number,
      hours_required: s.hours_required,
      day_time: formatDayTime(s.day_of_week, s.time_slot)
    })),
    instructors: Array.from(instructorState.values()).map(i => ({
      id: i.id,
      name: i.full_name,
      hours_assigned: i.hoursAssigned,
      max_hours: i.maxHours,
      hours_remaining: i.maxHours - i.hoursAssigned
    })),
    qualifications: qualifications.map(q => ({ instructor_id: q.instructor_id, course_id: q.course_id })),
    unavailable_slots: availability.map(a => ({ instructor_id: a.instructor_id, day: a.day, time_slot: a.time_slot })),
    preferences: preferences.map(p => ({ instructor_id: p.instructor_id, section_id: p.section_id, rank: p.rank }))
  }

  const response = await createMessage({
    model: COPILOT_MODEL,
    max_tokens: 8192,
    system: SYSTEM_PROMPT,
    tools: [SCHEDULE_TOOL],
    tool_choice: { type: 'tool', name: 'submit_schedule_plan' },
    messages: [{ role: 'user', content: JSON.stringify(payload) }]
  })

  const toolUse = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'submit_schedule_plan')
  const input = (toolUse?.input || { assignments: [], unassignable: [] }) as {
    assignments: { section_id: string; instructor_id: string; rationale: string }[]
    unassignable: { section_id: string; reason: string }[]
  }

  const sectionById = new Map(sections.map(s => [s.id, s]))
  const runningAssignments: RawAssignment[] = [...liveAssignments]
  const accepted: AcceptedItem[] = []
  const rejected: RejectedItem[] = []
  const handledSectionIds = new Set<string>()

  const sectionLabel = (s: RawSection) => `${s.course.code} — Section ${s.section_number}`

  for (const proposal of input.assignments) {
    const section = sectionById.get(proposal.section_id)
    const instructor = instructorState.get(proposal.instructor_id)

    if (!section) continue // invented/unknown section id — skip silently
    if (handledSectionIds.has(section.id)) continue // duplicate proposal for an already-handled section

    if (!instructor) {
      rejected.push({ sectionLabel: sectionLabel(section), reason: 'AI proposed an instructor id that does not exist — skipped.' })
      handledSectionIds.add(section.id)
      continue
    }

    const conflicts = checkAssignmentConflicts({
      instructorName: instructor.full_name,
      targetSection: section,
      existingAssignments: toConflictAssignments(runningAssignments.filter(a => a.instructor_id === instructor.id)),
      unavailableSlots: toConflictAvailability(availability.filter(a => a.instructor_id === instructor.id)),
      hoursAlreadyAssigned: instructor.hoursAssigned,
      maxHoursPerTerm: instructor.maxHours
    })

    if (conflicts.length > 0) {
      rejected.push({
        sectionLabel: sectionLabel(section),
        reason: `AI suggested ${instructor.full_name} but this is blocked: ${conflicts.join('; ')}`
      })
      handledSectionIds.add(section.id)
      continue
    }

    instructor.hoursAssigned += section.hours_required
    runningAssignments.push({
      instructor_id: instructor.id,
      hours_assigned: section.hours_required,
      section_id: section.id,
      section: { id: section.id, section_number: section.section_number, hours_required: section.hours_required, day_of_week: section.day_of_week, time_slot: section.time_slot, course: { code: section.course.code } }
    })

    accepted.push({
      sectionId: section.id,
      instructorId: instructor.id,
      hours: section.hours_required,
      sectionLabel: sectionLabel(section),
      instructorName: instructor.full_name,
      dayTime: formatDayTime(section.day_of_week, section.time_slot),
      rationale: proposal.rationale
    })
    handledSectionIds.add(section.id)
  }

  for (const item of input.unassignable) {
    const section = sectionById.get(item.section_id)
    if (!section || handledSectionIds.has(section.id)) continue
    rejected.push({ sectionLabel: sectionLabel(section), reason: item.reason })
    handledSectionIds.add(section.id)
  }

  // Anything the model never mentioned at all still needs to be accounted for.
  for (const section of sections) {
    if (!handledSectionIds.has(section.id)) {
      rejected.push({ sectionLabel: sectionLabel(section), reason: 'AI did not propose an assignment for this section.' })
    }
  }

  return { accepted, rejected, noSectionsFound: false }
}
