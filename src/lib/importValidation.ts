import { supabase } from './supabase'

export interface RowIssue {
  rowIndex: number
  message: string
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function validateCourseRows(rows: { code: string; name: string }[]): Promise<RowIssue[]> {
  const issues: RowIssue[] = []
  const seenCodes = new Set<string>()

  const { data: existing } = await supabase.from('courses').select('code')
  const existingCodes = new Set((existing || []).map(c => c.code.toUpperCase()))

  rows.forEach((row, i) => {
    const code = (row.code || '').trim()
    const name = (row.name || '').trim()
    if (!code) { issues.push({ rowIndex: i, message: 'Missing course code' }); return }
    if (!name) { issues.push({ rowIndex: i, message: 'Missing course name' }); return }
    const upper = code.toUpperCase()
    if (seenCodes.has(upper)) { issues.push({ rowIndex: i, message: `Duplicate code "${code}" within this file` }); return }
    seenCodes.add(upper)
    if (existingCodes.has(upper)) { issues.push({ rowIndex: i, message: `Course code "${code}" already exists` }) }
  })

  return issues
}

export async function validateInstructorRows(rows: { full_name: string; email: string; max_hours?: string }[]): Promise<RowIssue[]> {
  const issues: RowIssue[] = []
  const seenEmails = new Set<string>()

  const { data: existing } = await supabase.from('profiles').select('email').eq('role', 'instructor')
  const existingEmails = new Set((existing || []).map(p => p.email.toLowerCase()))

  rows.forEach((row, i) => {
    const name = (row.full_name || '').trim()
    const email = (row.email || '').trim()
    if (!name) { issues.push({ rowIndex: i, message: 'Missing full name' }); return }
    if (!email) { issues.push({ rowIndex: i, message: 'Missing email' }); return }
    if (!EMAIL_RE.test(email)) { issues.push({ rowIndex: i, message: `"${email}" doesn't look like a valid email` }); return }
    const lower = email.toLowerCase()
    if (seenEmails.has(lower)) { issues.push({ rowIndex: i, message: `Duplicate email "${email}" within this file` }); return }
    seenEmails.add(lower)
    if (existingEmails.has(lower)) { issues.push({ rowIndex: i, message: `An instructor with email "${email}" already exists` }); return }
    if (row.max_hours && row.max_hours.trim() && (isNaN(parseInt(row.max_hours)) || parseInt(row.max_hours) <= 0)) {
      issues.push({ rowIndex: i, message: `"${row.max_hours}" isn't a valid number of hours` })
    }
  })

  return issues
}
