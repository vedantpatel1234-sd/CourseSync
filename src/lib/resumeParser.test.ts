import { describe, it, expect, vi, beforeEach } from 'vitest'
import { parseResume } from './resumeParser'
import { supabase } from './supabase'
import { createMessage } from './anthropic'

vi.mock('./supabase', () => ({
  supabase: { from: vi.fn() }
}))

vi.mock('./anthropic', () => ({
  createMessage: vi.fn(),
  COPILOT_MODEL: 'claude-opus-5'
}))

function chainable(data: unknown) {
  const chain: PromiseLike<{ data: unknown; error: null }> & Record<string, unknown> = {
    select: () => chain,
    then: (resolve: (v: { data: unknown; error: null }) => unknown) => Promise.resolve({ data, error: null }).then(resolve)
  } as never
  return chain
}

const COURSES = [
  { id: 'course-1', code: 'CS101', name: 'Intro to CS' },
  { id: 'course-2', code: 'CS201', name: 'Data Structures' }
]

function mockPdfFile(sizeBytes: number, type = 'application/pdf') {
  const file = new File([new Uint8Array(sizeBytes)], 'resume.pdf', { type })
  return file
}

function mockAiResponse(input: {
  full_name: string; email: string; department: string; title: string
  suggested_max_hours_per_term: number
  qualified_courses: { course_id: string; reason: string }[]
} | null) {
  vi.mocked(createMessage).mockResolvedValue({
    content: input ? [{ type: 'tool_use', id: 'tool_1', name: 'submit_resume_info', input }] : []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any)
}

describe('parseResume', () => {
  beforeEach(() => {
    vi.mocked(supabase.from).mockReset()
    vi.mocked(supabase.from).mockReturnValue(chainable(COURSES) as never)
    vi.mocked(createMessage).mockReset()
  })

  it('rejects a non-PDF file before touching the network', async () => {
    const file = new File(['hello'], 'resume.docx', { type: 'application/msword' })
    await expect(parseResume(file)).rejects.toThrow('Please upload a PDF file.')
    expect(createMessage).not.toHaveBeenCalled()
  })

  it('rejects a PDF over 4MB before touching the network', async () => {
    const file = mockPdfFile(5 * 1024 * 1024)
    await expect(parseResume(file)).rejects.toThrow('File is too large — please upload a PDF under 4MB.')
    expect(createMessage).not.toHaveBeenCalled()
  })

  it('accepts a PDF right at the 4MB boundary', async () => {
    mockAiResponse({ full_name: 'Jane Doe', email: 'jane@example.com', department: 'CS', title: 'Lecturer', suggested_max_hours_per_term: 30, qualified_courses: [] })
    const file = mockPdfFile(4 * 1024 * 1024)
    await expect(parseResume(file)).resolves.toBeDefined()
  })

  it('extracts profile fields from the tool_use response', async () => {
    mockAiResponse({
      full_name: 'Jane Doe', email: 'jane@example.com', department: 'Computer Science', title: 'Assistant Professor',
      suggested_max_hours_per_term: 25, qualified_courses: []
    })
    const result = await parseResume(mockPdfFile(1000))
    expect(result.fullName).toBe('Jane Doe')
    expect(result.email).toBe('jane@example.com')
    expect(result.department).toBe('Computer Science')
    expect(result.title).toBe('Assistant Professor')
    expect(result.maxHoursPerTerm).toBe(25)
  })

  it('defaults max hours to 40 when the model gives a non-positive number', async () => {
    mockAiResponse({ full_name: '', email: '', department: '', title: '', suggested_max_hours_per_term: 0, qualified_courses: [] })
    const result = await parseResume(mockPdfFile(1000))
    expect(result.maxHoursPerTerm).toBe(40)
  })

  it('resolves qualified_courses against the real course catalog', async () => {
    mockAiResponse({
      full_name: 'Jane Doe', email: '', department: '', title: '', suggested_max_hours_per_term: 30,
      qualified_courses: [{ course_id: 'course-1', reason: 'Taught intro CS for 5 years' }]
    })
    const result = await parseResume(mockPdfFile(1000))
    expect(result.qualificationSuggestions).toEqual([
      { courseId: 'course-1', code: 'CS101', name: 'Intro to CS', reason: 'Taught intro CS for 5 years' }
    ])
  })

  it('drops a qualified_courses entry that references a course id not in the catalog', async () => {
    mockAiResponse({
      full_name: 'Jane Doe', email: '', department: '', title: '', suggested_max_hours_per_term: 30,
      qualified_courses: [{ course_id: 'course-invented', reason: 'made up' }]
    })
    const result = await parseResume(mockPdfFile(1000))
    expect(result.qualificationSuggestions).toEqual([])
  })

  it('throws when the model returns no tool_use block', async () => {
    mockAiResponse(null)
    await expect(parseResume(mockPdfFile(1000))).rejects.toThrow('Could not parse the resume — please fill the form manually.')
  })

  it('sends the course catalog to the model alongside the PDF', async () => {
    mockAiResponse({ full_name: '', email: '', department: '', title: '', suggested_max_hours_per_term: 30, qualified_courses: [] })
    await parseResume(mockPdfFile(1000))

    const call = vi.mocked(createMessage).mock.calls[0][0]
    const content = call.messages[0].content as Array<{ type: string; text?: string; source?: { media_type: string } }>
    const docBlock = content.find(b => b.type === 'document')
    const textBlock = content.find(b => b.type === 'text')
    expect(docBlock?.source?.media_type).toBe('application/pdf')
    expect(textBlock?.text).toContain('CS101')
    expect(textBlock?.text).toContain('CS201')
  })
})
