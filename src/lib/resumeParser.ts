import type Anthropic from '@anthropic-ai/sdk'
import { createMessage, COPILOT_MODEL } from './anthropic'
import { supabase } from './supabase'

export interface QualificationSuggestion {
  courseId: string
  code: string
  name: string
  reason: string
}

export interface ParsedResume {
  fullName: string
  email: string
  department: string
  title: string
  maxHoursPerTerm: number
  qualificationSuggestions: QualificationSuggestion[]
}

const RESUME_TOOL: Anthropic.Tool = {
  name: 'submit_resume_info',
  description: 'Submit the instructor profile info extracted from the resume, plus any course qualification matches against the provided catalog.',
  input_schema: {
    type: 'object',
    properties: {
      full_name: { type: 'string', description: 'The person\'s full name as it appears on the resume. Empty string if not found.' },
      email: { type: 'string', description: 'Their email address if one appears in the document. Empty string if not found.' },
      department: { type: 'string', description: 'Best-guess academic department based on their background, e.g. "Computer Science". Empty string if unclear.' },
      title: { type: 'string', description: 'Best-guess academic title, e.g. "Assistant Professor" or "Lecturer". Empty string if unclear.' },
      suggested_max_hours_per_term: { type: 'integer', description: 'A reasonable max teaching hours per term for this person (typically 20-40). Default to 40 if the resume gives no signal either way.' },
      qualified_courses: {
        type: 'array',
        description: 'Courses from the catalog you were given that this person has genuine subject-matter background to teach. Be conservative — only include real matches, not guesses.',
        items: {
          type: 'object',
          properties: {
            course_id: { type: 'string', description: 'Exact id from the catalog given to you.' },
            reason: { type: 'string', description: 'One short phrase citing what in the resume supports this match.' }
          },
          required: ['course_id', 'reason']
        }
      }
    },
    required: ['full_name', 'email', 'department', 'title', 'suggested_max_hours_per_term', 'qualified_courses']
  }
}

const SYSTEM_PROMPT = `You extract instructor profile information from an academic resume/CV to help an admin pre-fill an "add instructor" form. Be conservative: only state what the document actually supports, and leave a field as an empty string rather than inventing information that is not present. When matching qualifications, only include courses from the given catalog that the resume gives genuine subject-matter support for — do not include a course just because it sounds generally related. Call submit_resume_info exactly once.`

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      resolve(result.split(',')[1] || '')
    }
    reader.onerror = () => reject(new Error('Could not read the file.'))
    reader.readAsDataURL(file)
  })
}

export async function parseResume(file: File): Promise<ParsedResume> {
  if (file.type !== 'application/pdf') {
    throw new Error('Please upload a PDF file.')
  }
  if (file.size > 4 * 1024 * 1024) {
    // Base64-encoded and sent through the ai-proxy Edge Function, which has a
    // tighter request-body limit than a direct browser-to-Anthropic call did.
    throw new Error('File is too large — please upload a PDF under 4MB.')
  }

  const [base64, coursesResult] = await Promise.all([
    fileToBase64(file),
    supabase.from('courses').select('id, code, name')
  ])
  const courses = coursesResult.data || []

  const response = await createMessage({
    model: COPILOT_MODEL,
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    tools: [RESUME_TOOL],
    tool_choice: { type: 'tool', name: 'submit_resume_info' },
    messages: [{
      role: 'user',
      content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
        { type: 'text', text: `Course catalog to match qualifications against:\n${JSON.stringify(courses)}\n\nExtract this instructor's profile info and suggest qualifications from the catalog above.` }
      ]
    }]
  })

  const toolUse = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'submit_resume_info')
  if (!toolUse) {
    throw new Error('Could not parse the resume — please fill the form manually.')
  }

  const input = toolUse.input as {
    full_name: string
    email: string
    department: string
    title: string
    suggested_max_hours_per_term: number
    qualified_courses: { course_id: string; reason: string }[]
  }

  const courseById = new Map(courses.map(c => [c.id, c]))
  const qualificationSuggestions: QualificationSuggestion[] = input.qualified_courses
    .map(q => {
      const course = courseById.get(q.course_id)
      return course ? { courseId: course.id, code: course.code, name: course.name, reason: q.reason } : null
    })
    .filter((q): q is QualificationSuggestion => q !== null)

  return {
    fullName: input.full_name || '',
    email: input.email || '',
    department: input.department || '',
    title: input.title || '',
    maxHoursPerTerm: input.suggested_max_hours_per_term > 0 ? input.suggested_max_hours_per_term : 40,
    qualificationSuggestions
  }
}
