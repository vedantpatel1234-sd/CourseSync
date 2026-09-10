import type Anthropic from '@anthropic-ai/sdk'
import { supabase } from './supabase'
import { DAYS, TIME_SLOTS, formatDayTime } from './schedule'
import { checkAssignmentConflicts, type ExistingAssignmentInfo, type UnavailableSlot } from './conflicts'

const MORNING_SLOTS = ['8:00 AM', '9:00 AM', '10:00 AM', '11:00 AM']
const AFTERNOON_SLOTS = ['12:00 PM', '1:00 PM', '2:00 PM', '3:00 PM', '4:00 PM']

// ---------------------------------------------------------------------------
// Shared fetch helpers — every fact the copilot states comes from one of these,
// never from the model's own knowledge.
// ---------------------------------------------------------------------------

interface RawSection {
  id: string
  section_number: string
  hours_required: number
  status: string
  day_of_week: string | null
  time_slot: string | null
  course_id: string
  course: { code: string; name: string }
  term: { name: string }
}

interface RawInstructor {
  id: string
  full_name: string
  instructor_profiles: { max_hours_per_term: number } | null
}

interface AssignmentRow {
  id: string
  hours_assigned: number
  instructor_id: string
  section_id: string
  instructor: { id: string; full_name: string }
  section: {
    id: string
    section_number: string
    hours_required: number
    day_of_week: string | null
    time_slot: string | null
    course: { code: string }
  }
}

interface AvailabilityRow {
  instructor_id: string
  day: string
  time_slot: string
}

interface QualificationRow {
  instructor_id: string
  course_id: string
}

async function fetchSections(): Promise<RawSection[]> {
  const { data } = await supabase
    .from('sections')
    .select('*, course:courses(code, name), term:terms(name)')
    .order('created_at')
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

async function fetchLiveAssignments(): Promise<AssignmentRow[]> {
  const { data } = await supabase
    .from('assignments')
    .select(`
      id, hours_assigned, instructor_id, section_id,
      instructor:profiles!assignments_instructor_id_fkey(id, full_name),
      section:sections!assignments_section_id_fkey(id, section_number, hours_required, day_of_week, time_slot, course:courses(code))
    `)
    .is('draft_id', null)
    .neq('status', 'rejected')
  return (data || []) as unknown as AssignmentRow[]
}

async function fetchQualifications(): Promise<QualificationRow[]> {
  const { data } = await supabase.from('qualifications').select('instructor_id, course_id').eq('verified', true)
  return (data || []) as QualificationRow[]
}

async function fetchAvailability(): Promise<AvailabilityRow[]> {
  const { data } = await supabase.from('instructor_availability').select('instructor_id, day, time_slot')
  return (data || []) as AvailabilityRow[]
}

function buildInstructorInfo(instructors: RawInstructor[], assignments: AssignmentRow[]) {
  return instructors.map(p => ({
    id: p.id,
    full_name: p.full_name,
    hoursAssigned: assignments
      .filter(a => a.instructor_id === p.id)
      .reduce((sum, a) => sum + a.hours_assigned, 0),
    maxHours: p.instructor_profiles?.max_hours_per_term || 40
  }))
}

function toConflictAssignments(assignments: AssignmentRow[]): ExistingAssignmentInfo[] {
  return assignments.map(a => ({ section_id: a.section_id, section: a.section }))
}

function toConflictAvailability(availability: AvailabilityRow[]): UnavailableSlot[] {
  return availability.map(a => ({ day: a.day, time_slot: a.time_slot }))
}

// ---------------------------------------------------------------------------
// Read-only ("fact") tools
// ---------------------------------------------------------------------------

export async function listUnassignedSections() {
  const [sections, instructors, assignments, qualifications, availability] = await Promise.all([
    fetchSections(), fetchInstructors(), fetchLiveAssignments(), fetchQualifications(), fetchAvailability()
  ])
  const instructorInfo = buildInstructorInfo(instructors, assignments)
  const unassigned = sections.filter(s => s.status === 'unassigned')

  const results = unassigned.map(section => {
    const qualifiedIds = qualifications.filter(q => q.course_id === section.course_id).map(q => q.instructor_id)

    if (qualifiedIds.length === 0) {
      return {
        id: section.id,
        course_code: section.course.code,
        section_number: section.section_number,
        term: section.term.name,
        day_time: formatDayTime(section.day_of_week, section.time_slot),
        hours_required: section.hours_required,
        reason: `No verified instructor is qualified to teach ${section.course.code}.`
      }
    }

    const evaluated = qualifiedIds
      .map(id => instructorInfo.find(i => i.id === id))
      .filter((i): i is NonNullable<typeof i> => !!i)
      .map(instructor => {
        const conflicts = checkAssignmentConflicts({
          instructorName: instructor.full_name,
          targetSection: section,
          existingAssignments: toConflictAssignments(assignments.filter(a => a.instructor_id === instructor.id)),
          unavailableSlots: toConflictAvailability(availability.filter(a => a.instructor_id === instructor.id)),
          hoursAlreadyAssigned: instructor.hoursAssigned,
          maxHoursPerTerm: instructor.maxHours
        })
        return { name: instructor.full_name, available: conflicts.length === 0, blockReason: conflicts[0] }
      })

    const available = evaluated.filter(e => e.available)
    const reason = available.length > 0
      ? `${evaluated.length} qualified instructor(s) found; ${available.length} available right now (e.g. ${available[0].name}) — just needs to be assigned.`
      : `${evaluated.length} qualified instructor(s) exist for ${section.course.code}, but none are currently available: ` +
        evaluated.map(e => `${e.name} (${(e.blockReason || 'unavailable').replace('Blocked: ', '')})`).join('; ')

    return {
      id: section.id,
      course_code: section.course.code,
      section_number: section.section_number,
      term: section.term.name,
      day_time: formatDayTime(section.day_of_week, section.time_slot),
      hours_required: section.hours_required,
      reason
    }
  })

  return { count: results.length, sections: results }
}

export interface FindInstructorsInput {
  course_code: string
  day_of_week?: string
  time_slot?: string
  time_period?: 'morning' | 'afternoon'
}

export interface WorkloadInput {
  instructor_name?: string
}

export interface ListSectionsInput {
  status?: string
  term_name?: string
}

export interface AssignmentActionInput {
  section_id: string
  instructor_id: string
}

export interface DraftActionInput {
  name: string
  term_name: string
}

export async function findQualifiedInstructors(input: FindInstructorsInput) {
  const [sections, instructors, assignments, qualifications, availability] = await Promise.all([
    fetchSections(), fetchInstructors(), fetchLiveAssignments(), fetchQualifications(), fetchAvailability()
  ])

  const courseSections = sections.filter(s => s.course.code.toLowerCase() === input.course_code.toLowerCase())
  if (courseSections.length === 0) {
    return { error: `No sections found for course code "${input.course_code}".` }
  }

  let candidates = courseSections
  if (input.day_of_week) candidates = candidates.filter(s => s.day_of_week === input.day_of_week)
  if (input.time_slot) {
    candidates = candidates.filter(s => s.time_slot === input.time_slot)
  } else if (input.time_period) {
    const slots = input.time_period === 'morning' ? MORNING_SLOTS : AFTERNOON_SLOTS
    candidates = candidates.filter(s => s.time_slot && slots.includes(s.time_slot))
  }

  if (candidates.length === 0) {
    return {
      error: `No ${input.course_code} section matches that day/time. Existing ${input.course_code} sections: ` +
        courseSections.map(s => `Section ${s.section_number} (${formatDayTime(s.day_of_week, s.time_slot)}, ${s.status})`).join(', ')
    }
  }

  const section = candidates.find(s => s.status === 'unassigned') || candidates[0]
  const qualifiedIds = qualifications.filter(q => q.course_id === section.course_id).map(q => q.instructor_id)
  const instructorInfo = buildInstructorInfo(instructors, assignments)

  const evaluated = qualifiedIds
    .map(id => instructorInfo.find(i => i.id === id))
    .filter((i): i is NonNullable<typeof i> => !!i)
    .map(instructor => {
      const conflicts = checkAssignmentConflicts({
        instructorName: instructor.full_name,
        targetSection: section,
        existingAssignments: toConflictAssignments(assignments.filter(a => a.instructor_id === instructor.id)),
        unavailableSlots: toConflictAvailability(availability.filter(a => a.instructor_id === instructor.id)),
        hoursAlreadyAssigned: instructor.hoursAssigned,
        maxHoursPerTerm: instructor.maxHours
      })
      return {
        instructor_id: instructor.id,
        name: instructor.full_name,
        hours_assigned: instructor.hoursAssigned,
        max_hours: instructor.maxHours,
        hours_remaining: instructor.maxHours - instructor.hoursAssigned,
        available: conflicts.length === 0,
        block_reasons: conflicts
      }
    })

  const available = evaluated.filter(e => e.available).sort((a, b) => b.hours_remaining - a.hours_remaining)
  const unavailable = evaluated.filter(e => !e.available)

  if (qualifiedIds.length === 0) {
    return {
      matched_section: {
        id: section.id,
        course_code: section.course.code,
        section_number: section.section_number,
        day_time: formatDayTime(section.day_of_week, section.time_slot),
        status: section.status
      },
      error: `No verified instructor is qualified to teach ${section.course.code}.`
    }
  }

  return {
    matched_section: {
      id: section.id,
      course_code: section.course.code,
      section_number: section.section_number,
      day_time: formatDayTime(section.day_of_week, section.time_slot),
      status: section.status
    },
    available_instructors: available,
    unavailable_instructors: unavailable
  }
}

export async function getInstructorWorkload(input: WorkloadInput) {
  const [instructors, assignments] = await Promise.all([fetchInstructors(), fetchLiveAssignments()])
  const info = buildInstructorInfo(instructors, assignments)
  const filtered = input.instructor_name
    ? info.filter(i => i.full_name.toLowerCase().includes(input.instructor_name!.toLowerCase()))
    : info

  if (input.instructor_name && filtered.length === 0) {
    return { error: `No instructor found matching "${input.instructor_name}".` }
  }

  return {
    instructors: filtered.map(i => ({
      name: i.full_name,
      hours_assigned: i.hoursAssigned,
      max_hours: i.maxHours,
      hours_remaining: i.maxHours - i.hoursAssigned
    }))
  }
}

export async function listSectionsTool(input: ListSectionsInput) {
  const sections = await fetchSections()
  let filtered = sections
  if (input.status && input.status !== 'all') filtered = filtered.filter(s => s.status === input.status)
  if (input.term_name) {
    filtered = filtered.filter(s => s.term.name.toLowerCase().includes(input.term_name!.toLowerCase()))
  }
  return {
    count: filtered.length,
    sections: filtered.map(s => ({
      id: s.id,
      course_code: s.course.code,
      course_name: s.course.name,
      section_number: s.section_number,
      term: s.term.name,
      day_time: formatDayTime(s.day_of_week, s.time_slot),
      hours_required: s.hours_required,
      status: s.status
    }))
  }
}

export async function listAssignmentsTool() {
  const assignments = await fetchLiveAssignments()
  return {
    count: assignments.length,
    assignments: assignments.map(a => ({
      instructor: a.instructor.full_name,
      course_code: a.section.course.code,
      section_number: a.section.section_number,
      day_time: formatDayTime(a.section.day_of_week, a.section.time_slot),
      hours: a.hours_assigned
    }))
  }
}

// ---------------------------------------------------------------------------
// Action previews — build a fully rules-checked preview, but never write to
// the database here. The caller (AI.tsx) only writes after the admin clicks
// Confirm, using the exact ids captured in the preview.
// ---------------------------------------------------------------------------

export interface AssignmentPreview {
  kind: 'assignment'
  sectionId: string
  instructorId: string
  sectionLabel: string
  instructorName: string
  hours: number
  dayTime: string
  blocked: boolean
  reasons: string[]
}

export async function buildAssignmentPreview(input: AssignmentActionInput): Promise<AssignmentPreview | { error: string }> {
  const [sections, instructors, assignments, availability] = await Promise.all([
    fetchSections(), fetchInstructors(), fetchLiveAssignments(), fetchAvailability()
  ])

  const section = sections.find(s => s.id === input.section_id)
  const instructor = instructors.find(i => i.id === input.instructor_id)
  if (!section) return { error: `No section found with id ${input.section_id}. Call a list tool first and use the exact id it returns.` }
  if (!instructor) return { error: `No instructor found with id ${input.instructor_id}. Call a list tool first and use the exact id it returns.` }

  const instructorInfo = buildInstructorInfo(instructors, assignments).find(i => i.id === instructor.id)!
  const reasons: string[] = []

  const alreadyAssigned = assignments.find(a => a.section_id === section.id)
  if (alreadyAssigned) {
    reasons.push(`Blocked: this section already has an instructor assigned (${alreadyAssigned.instructor.full_name}).`)
  }

  reasons.push(...checkAssignmentConflicts({
    instructorName: instructor.full_name,
    targetSection: section,
    existingAssignments: toConflictAssignments(assignments.filter(a => a.instructor_id === instructor.id)),
    unavailableSlots: toConflictAvailability(availability.filter(a => a.instructor_id === instructor.id)),
    hoursAlreadyAssigned: instructorInfo.hoursAssigned,
    maxHoursPerTerm: instructorInfo.maxHours
  }))

  return {
    kind: 'assignment',
    sectionId: section.id,
    instructorId: instructor.id,
    sectionLabel: `${section.course.code} — Section ${section.section_number}`,
    instructorName: instructor.full_name,
    hours: section.hours_required,
    dayTime: formatDayTime(section.day_of_week, section.time_slot),
    blocked: reasons.length > 0,
    reasons
  }
}

export interface DraftPreview {
  kind: 'draft'
  name: string
  termId: string
  termName: string
  blocked: boolean
  reasons: string[]
}

export async function buildDraftPreview(input: DraftActionInput): Promise<DraftPreview | { error: string }> {
  const { data: terms } = await supabase.from('terms').select('id, name')
  const term = terms?.find(t => t.name.toLowerCase().includes(input.term_name.toLowerCase()))
  if (!term) {
    return { error: `No term found matching "${input.term_name}". Available terms: ${terms?.map(t => t.name).join(', ') || 'none'}.` }
  }

  const reasons: string[] = []
  const name = (input.name || '').trim()
  if (name.length < 2) reasons.push('Blocked: draft name must be at least 2 characters.')

  return {
    kind: 'draft',
    name,
    termId: term.id,
    termName: term.name,
    blocked: reasons.length > 0,
    reasons
  }
}

// ---------------------------------------------------------------------------
// Tool schemas passed to the Messages API
// ---------------------------------------------------------------------------

export const ACTION_TOOL_NAMES = ['propose_assignment', 'propose_create_draft'] as const

export const COPILOT_TOOLS: Anthropic.Tool[] = [
  {
    name: 'list_unassigned_sections',
    description: 'List every currently unassigned live section, with a plain-English reason each one is unassigned (no qualified instructor, or qualified instructors are unavailable/over hours, etc). Use this for requests like "show me unassigned sections and why".',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'find_qualified_instructors',
    description: 'Find verified-qualified instructors for a course, filtered to those with no scheduling conflict at a given day/time, ranked by hours remaining. Use this for requests like "find a qualified available instructor for COMP2205 Tuesday morning". Returns the matched section and both available and unavailable candidates (with reasons).',
    input_schema: {
      type: 'object',
      properties: {
        course_code: { type: 'string', description: 'Course code, e.g. COMP2205' },
        day_of_week: { type: 'string', enum: [...DAYS], description: 'Exact day to filter to, if the user gave one' },
        time_slot: { type: 'string', enum: [...TIME_SLOTS], description: 'Exact time slot to filter to, if the user gave one' },
        time_period: { type: 'string', enum: ['morning', 'afternoon'], description: 'Use when the user said a coarse period like "morning" or "afternoon" instead of an exact time. Morning = 8:00-11:00 AM, afternoon = 12:00-4:00 PM.' }
      },
      required: ['course_code']
    }
  },
  {
    name: 'get_instructor_workload',
    description: 'Get hours assigned vs. max hours per term for one instructor (by name, partial match ok) or all instructors if no name is given.',
    input_schema: {
      type: 'object',
      properties: {
        instructor_name: { type: 'string', description: 'Full or partial instructor name. Omit to list all instructors.' }
      }
    }
  },
  {
    name: 'list_sections',
    description: 'List course sections with their status, day/time, and hours. Optionally filter by status or term.',
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['unassigned', 'partial', 'filled', 'all'], description: 'Filter by section status. Defaults to all.' },
        term_name: { type: 'string', description: 'Filter to a term by name (partial match ok), e.g. "Winter 2026"' }
      }
    }
  },
  {
    name: 'list_assignments',
    description: 'List all current live instructor-section assignments (does not include draft assignments).',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'propose_assignment',
    description: 'Stage a proposed instructor assignment for the admin to review. This does NOT execute the assignment — it only prepares a preview the admin must explicitly confirm in the UI. Requires section_id and instructor_id exactly as returned by a previous list_sections or find_qualified_instructors call — never invent an id.',
    input_schema: {
      type: 'object',
      properties: {
        section_id: { type: 'string', description: 'Exact section id from a prior tool result' },
        instructor_id: { type: 'string', description: 'Exact instructor id from a prior tool result' }
      },
      required: ['section_id', 'instructor_id']
    }
  },
  {
    name: 'propose_create_draft',
    description: 'Stage a proposed new draft schedule for the admin to review. This does NOT create the draft — it only prepares a preview the admin must explicitly confirm in the UI.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Name for the new draft' },
        term_name: { type: 'string', description: 'Term the draft belongs to, by name (partial match ok)' }
      },
      required: ['name', 'term_name']
    }
  }
]
