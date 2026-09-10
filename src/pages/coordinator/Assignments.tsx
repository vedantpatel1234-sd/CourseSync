import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { formatDayTime } from '../../lib/schedule'

interface Assignment {
  id: string
  hours_assigned: number
  instructor: { full_name: string; email: string }
  section: {
    section_number: string
    status: string
    day_of_week: string | null
    time_slot: string | null
    course: { code: string; name: string }
    term: { name: string }
  }
}

export default function CoordinatorAssignments() {
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchAssignments = async () => {
      const { data } = await supabase
        .from('assignments')
        .select('*, instructor:profiles!assignments_instructor_id_fkey(full_name, email), section:sections(section_number, status, day_of_week, time_slot, course:courses(code, name), term:terms(name))')
        .is('draft_id', null)
        .neq('status', 'rejected')

      if (data) setAssignments(data as Assignment[])
      setLoading(false)
    }
    fetchAssignments()
  }, [])

  const statusColors: Record<string, { color: string; bg: string }> = {
    unassigned: { color: '#A32D2D', bg: '#FCEBEB' },
    partial: { color: '#854F0B', bg: '#FAEEDA' },
    filled: { color: '#0F6E56', bg: '#EAF3DE' },
  }

  return (
    <div style={{ padding: 32, fontFamily: 'DM Sans, sans-serif' }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1A1A2E', marginBottom: 4 }}>
        Assignments
      </h1>
      <p style={{ fontSize: 14, color: '#6B6B80', marginBottom: 32 }}>
        View all instructor assignments — read only
      </p>

      <div style={{ background: 'white', borderRadius: 12, border: '1px solid rgba(0,0,0,0.06)', boxShadow: 'var(--shadow-card)', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid rgba(0,0,0,0.07)' }}>
              {['Course', 'Section', 'Term', 'Day / Time', 'Instructor', 'Hours', 'Status'].map(h => (
                <th key={h} style={{
                  padding: '12px 16px', textAlign: 'left',
                  fontSize: 12, fontWeight: 600, color: '#6B6B80',
                  textTransform: 'uppercase', letterSpacing: '0.5px'
                }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} style={{ padding: 24, textAlign: 'center', color: '#6B6B80' }}>Loading...</td>
              </tr>
            ) : assignments.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ padding: 24, textAlign: 'center', color: '#6B6B80' }}>No assignments yet.</td>
              </tr>
            ) : assignments.map(a => (
              <tr key={a.id} style={{ borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
                <td style={{ padding: '12px 16px' }}>
                  <span style={{ background: '#EEEDFE', color: '#534AB7', padding: '3px 10px', borderRadius: 20, fontSize: 13, fontWeight: 600 }}>
                    {a.section.course.code}
                  </span>
                </td>
                <td style={{ padding: '12px 16px', fontSize: 14, color: '#1A1A2E' }}>Section {a.section.section_number}</td>
                <td style={{ padding: '12px 16px', fontSize: 14, color: '#6B6B80' }}>{a.section.term.name}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: '#1A1A2E' }}>{formatDayTime(a.section.day_of_week, a.section.time_slot)}</td>
                <td style={{ padding: '12px 16px', fontSize: 14, color: '#1A1A2E' }}>{a.instructor.full_name}</td>
                <td style={{ padding: '12px 16px', fontSize: 14, color: '#1A1A2E' }}>{a.hours_assigned}h</td>
                <td style={{ padding: '12px 16px' }}>
                  <span style={{
                    background: statusColors[a.section.status]?.bg,
                    color: statusColors[a.section.status]?.color,
                    padding: '3px 10px', borderRadius: 20,
                    fontSize: 12, fontWeight: 600, textTransform: 'capitalize'
                  }}>
                    {a.section.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}