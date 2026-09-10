import type Anthropic from '@anthropic-ai/sdk'
import { anthropic, COPILOT_MODEL } from './anthropic'
import { supabase } from './supabase'

export interface UnfilledSectionStat {
  courseCode: string
  sectionNumber: string
  termName: string
  status: string
  daysUntilStart: number | null
}

export interface InstructorLoadStat {
  name: string
  hoursAssigned: number
  maxHours: number
  percent: number
}

export interface DigestStats {
  unfilledSections: UnfilledSectionStat[]
  overloadedInstructors: InstructorLoadStat[]
  underutilizedInstructors: InstructorLoadStat[]
  generatedAt: string
}

export interface DigestHighlight {
  severity: 'high' | 'medium' | 'low'
  text: string
}

export interface DigestResult {
  summary: string
  highlights: DigestHighlight[]
  stats: DigestStats
}

const DIGEST_TOOL: Anthropic.Tool = {
  name: 'submit_digest',
  description: 'Submit the weekly scheduling digest: a short narrative summary and a prioritized list of highlights.',
  input_schema: {
    type: 'object',
    properties: {
      summary: { type: 'string', description: '2-4 plain-English sentences giving an admin the state of scheduling this week.' },
      highlights: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            severity: { type: 'string', enum: ['high', 'medium', 'low'] },
            text: { type: 'string', description: 'One specific, actionable sentence about a real item from the stats given to you.' }
          },
          required: ['severity', 'text']
        }
      }
    },
    required: ['summary', 'highlights']
  }
}

const SYSTEM_PROMPT = `You write a weekly scheduling digest for an academic program admin, based entirely on real computed statistics you are given. Never invent a number, name, or fact that isn't in the stats — you are summarizing and prioritizing, not calculating. Put the most urgent items first: sections still unfilled whose term has already started or starts very soon, then instructors over or near their hour cap, then everything else. If the stats show no problems at all, say so plainly and keep the highlights list short or empty rather than inventing concerns. Call submit_digest exactly once.`

async function computeStats(): Promise<DigestStats> {
  const now = new Date()

  const { data: sections } = await supabase
    .from('sections')
    .select('section_number, status, course:courses(code), term:terms(name, start_date)')
    .neq('status', 'filled')

  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, full_name, instructor_profiles(max_hours_per_term)')
    .eq('role', 'instructor')

  const { data: assignments } = await supabase
    .from('assignments')
    .select('instructor_id, hours_assigned')
    .is('draft_id', null)
    .neq('status', 'rejected')

  const unfilledSections: UnfilledSectionStat[] = ((sections || []) as unknown as {
    section_number: string
    status: string
    course: { code: string }
    term: { name: string; start_date: string | null }
  }[]).map(s => {
    const daysUntilStart = s.term.start_date
      ? Math.ceil((new Date(s.term.start_date).getTime() - now.getTime()) / 86400000)
      : null
    return {
      courseCode: s.course.code,
      sectionNumber: s.section_number,
      termName: s.term.name,
      status: s.status,
      daysUntilStart
    }
  })

  const loadStats: InstructorLoadStat[] = ((profiles || []) as unknown as {
    id: string
    full_name: string
    instructor_profiles: { max_hours_per_term: number } | null
  }[]).map(p => {
    const hoursAssigned = (assignments || [])
      .filter(a => a.instructor_id === p.id)
      .reduce((sum, a) => sum + a.hours_assigned, 0)
    const maxHours = p.instructor_profiles?.max_hours_per_term || 40
    return { name: p.full_name, hoursAssigned, maxHours, percent: maxHours > 0 ? Math.round((hoursAssigned / maxHours) * 100) : 0 }
  })

  return {
    unfilledSections,
    overloadedInstructors: loadStats.filter(i => i.percent >= 90),
    underutilizedInstructors: loadStats.filter(i => i.percent <= 25),
    generatedAt: now.toISOString()
  }
}

export async function generateWeeklyDigest(): Promise<DigestResult> {
  const stats = await computeStats()

  const response = await anthropic.messages.create({
    model: COPILOT_MODEL,
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    tools: [DIGEST_TOOL],
    tool_choice: { type: 'tool', name: 'submit_digest' },
    messages: [{ role: 'user', content: JSON.stringify(stats) }]
  })

  const toolUse = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'submit_digest')
  const input = (toolUse?.input || { summary: 'No summary available.', highlights: [] }) as {
    summary: string
    highlights: DigestHighlight[]
  }

  return { summary: input.summary, highlights: input.highlights, stats }
}
