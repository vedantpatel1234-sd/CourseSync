import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { DAYS, TIME_SLOTS } from '../../lib/schedule'

interface Term {
  id: string
  name: string
  is_active: boolean
}

interface Section {
  id: string
  section_number: string
  hours_required: number
  status: string
  day_of_week: string | null
  time_slot: string | null
  course: { code: string; name: string }
}

interface Assignment {
  section_id: string
  instructor: { full_name: string }
}

const statusColors: Record<string, { color: string; bg: string; border: string }> = {
  unassigned: { color: '#A32D2D', bg: '#FCEBEB', border: 'rgba(163,45,45,0.25)' },
  partial: { color: '#854F0B', bg: '#FAEEDA', border: 'rgba(133,79,11,0.25)' },
  filled: { color: '#0F6E56', bg: '#EAF3DE', border: 'rgba(15,110,86,0.25)' },
}

export default function AdminCalendar() {
  const [terms, setTerms] = useState<Term[]>([])
  const [termId, setTermId] = useState('')
  const [sections, setSections] = useState<Section[]>([])
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchTerms = async () => {
      const { data } = await supabase.from('terms').select('id, name, is_active').order('name')
      if (data) {
        setTerms(data)
        const active = data.find(t => t.is_active) || data[0]
        if (active) setTermId(active.id)
      }
      setLoading(false)
    }
    fetchTerms()
  }, [])

  useEffect(() => {
    if (!termId) return
    const fetchSchedule = async () => {
      setLoading(true)
      const { data: sectionsData } = await supabase
        .from('sections')
        .select('id, section_number, hours_required, status, day_of_week, time_slot, course:courses(code, name)')
        .eq('term_id', termId)

      const sectionIds = (sectionsData || []).map(s => s.id)
      const { data: assignmentsData } = sectionIds.length > 0
        ? await supabase
            .from('assignments')
            .select('section_id, instructor:profiles!assignments_instructor_id_fkey(full_name)')
            .in('section_id', sectionIds)
            .is('draft_id', null)
            .neq('status', 'rejected')
        : { data: [] }

      if (sectionsData) setSections(sectionsData as unknown as Section[])
      if (assignmentsData) setAssignments(assignmentsData as unknown as Assignment[])
      setLoading(false)
    }
    fetchSchedule()
  }, [termId])

  const instructorBySection = useMemo(() => {
    const map = new Map<string, string>()
    for (const a of assignments) map.set(a.section_id, a.instructor.full_name)
    return map
  }, [assignments])

  const scheduledSections = sections.filter(s => s.day_of_week && s.time_slot)
  const unscheduledSections = sections.filter(s => !s.day_of_week || !s.time_slot)

  const cellSections = (day: string, slot: string) =>
    scheduledSections.filter(s => s.day_of_week === day && s.time_slot === slot)

  const inputStyle = {
    padding: '9px 14px',
    borderRadius: 9,
    border: '1.5px solid #e5e7eb',
    fontSize: 14,
    fontFamily: 'DM Sans, sans-serif',
    outline: 'none',
    color: '#1A1A2E',
    background: 'white'
  }

  return (
    <div style={{ padding: 32, fontFamily: 'DM Sans, sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 32 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1A1A2E', marginBottom: 4 }}>
            Calendar
          </h1>
          <p style={{ fontSize: 14, color: '#6B6B80' }}>
            The full weekly schedule at a glance, across every instructor
          </p>
        </div>
        <select value={termId} onChange={e => setTermId(e.target.value)} style={inputStyle}>
          {terms.map(t => (
            <option key={t.id} value={t.id}>{t.name}{t.is_active ? ' (active)' : ''}</option>
          ))}
        </select>
      </div>

      <div style={{ display: 'flex', gap: 20, marginBottom: 16 }}>
        {Object.entries(statusColors).map(([status, style]) => (
          <div key={status} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 14, height: 14, borderRadius: 4, background: style.bg, border: `1px solid ${style.color}` }} />
            <span style={{ fontSize: 12, color: '#6B6B80', textTransform: 'capitalize' }}>{status}</span>
          </div>
        ))}
      </div>

      {loading ? (
        <p style={{ color: '#6B6B80' }}>Loading...</p>
      ) : (
        <>
          <div style={{
            background: 'white', borderRadius: 12, border: '1px solid rgba(0,0,0,0.06)',
            boxShadow: 'var(--shadow-card)', overflow: 'hidden', marginBottom: 24
          }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(0,0,0,0.07)' }}>
                    <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: '#6B6B80', width: 90 }}>
                      Time
                    </th>
                    {DAYS.map(day => (
                      <th key={day} style={{ padding: '12px 10px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: '#6B6B80' }}>
                        {day}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {TIME_SLOTS.map(slot => (
                    <tr key={slot} style={{ borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
                      <td style={{ padding: '10px 16px', fontSize: 12, color: '#6B6B80', fontWeight: 500, verticalAlign: 'top' }}>
                        {slot}
                      </td>
                      {DAYS.map(day => {
                        const items = cellSections(day, slot)
                        return (
                          <td key={day} style={{ padding: '6px 6px', verticalAlign: 'top' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                              {items.map(section => {
                                const style = statusColors[section.status] || statusColors.unassigned
                                const instructorName = instructorBySection.get(section.id)
                                return (
                                  <Link
                                    key={section.id}
                                    to="/admin/assignments"
                                    style={{
                                      display: 'block', padding: '6px 8px', borderRadius: 7,
                                      background: style.bg, border: `1px solid ${style.border}`,
                                      textDecoration: 'none'
                                    }}
                                    title={`${section.course.name} — Section ${section.section_number}${instructorName ? ` (${instructorName})` : ''}`}
                                  >
                                    <div style={{ fontSize: 12, fontWeight: 700, color: style.color }}>
                                      {section.course.code} §{section.section_number}
                                    </div>
                                    <div style={{ fontSize: 11, color: style.color, opacity: 0.85, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                      {instructorName || 'Unassigned'}
                                    </div>
                                  </Link>
                                )
                              })}
                            </div>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {unscheduledSections.length > 0 && (
            <div style={{
              background: 'white', borderRadius: 12, border: '1px solid rgba(0,0,0,0.06)',
              boxShadow: 'var(--shadow-card)', padding: 20
            }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#1A1A2E', marginBottom: 4 }}>
                Not on the calendar ({unscheduledSections.length})
              </div>
              <div style={{ fontSize: 13, color: '#6B6B80', marginBottom: 14 }}>
                These sections have no day/time set yet, so they can't appear on a weekly grid.
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {unscheduledSections.map(section => {
                  const style = statusColors[section.status] || statusColors.unassigned
                  const instructorName = instructorBySection.get(section.id)
                  return (
                    <Link
                      key={section.id}
                      to="/admin/sections"
                      style={{
                        padding: '6px 12px', borderRadius: 20,
                        background: style.bg, color: style.color,
                        fontSize: 12, fontWeight: 600, textDecoration: 'none'
                      }}
                    >
                      {section.course.code} §{section.section_number}{instructorName ? ` — ${instructorName}` : ''}
                    </Link>
                  )
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
