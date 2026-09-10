import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../stores/authStore'
import { formatDayTime } from '../../lib/schedule'

interface Assignment {
  id: string
  hours_assigned: number
  status: string
  section: {
    section_number: string
    hours_required: number
    status: string
    day_of_week: string | null
    time_slot: string | null
    course: { code: string; name: string }
    term: { name: string }
  }
}

interface InstructorProfile {
  max_hours_per_term: number
}

export default function InstructorDashboard() {
  const { user } = useAuthStore()
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [profile, setProfile] = useState<InstructorProfile | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchData = async () => {
      if (!user) return

      const { data: profileData } = await supabase
        .from('instructor_profiles')
        .select('*')
        .eq('user_id', user.id)
        .single()

      const { data: assignmentsData } = await supabase
        .from('assignments')
        .select('*, section:sections(section_number, hours_required, status, day_of_week, time_slot, course:courses(code, name), term:terms(name))')
        .eq('instructor_id', user.id)
        .is('draft_id', null)
        .neq('status', 'rejected')

      if (profileData) setProfile(profileData)
      if (assignmentsData) setAssignments(assignmentsData as Assignment[])
      setLoading(false)
    }
    fetchData()
  }, [user])

  const totalHours = assignments.reduce((sum, a) => sum + a.hours_assigned, 0)
  const maxHours = profile?.max_hours_per_term || 40
  const remainingHours = maxHours - totalHours
  const percent = Math.min((totalHours / maxHours) * 100, 100)
  const barColor = percent >= 90 ? '#A32D2D' : percent >= 70 ? '#854F0B' : '#0F6E56'

  const statusColors: Record<string, { color: string; bg: string }> = {
    unassigned: { color: '#A32D2D', bg: '#FCEBEB' },
    partial: { color: '#854F0B', bg: '#FAEEDA' },
    filled: { color: '#0F6E56', bg: '#EAF3DE' },
  }

  return (
    <div style={{ padding: 32, fontFamily: 'DM Sans, sans-serif' }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1A1A2E', marginBottom: 4 }}>
        My Assignments
      </h1>
      <p style={{ fontSize: 14, color: '#6B6B80', marginBottom: 32 }}>
        Your current teaching assignments
      </p>

      {loading ? <p style={{ color: '#6B6B80' }}>Loading...</p> : (
        <>
          {/* Stat cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 24 }}>
            {[
              { label: 'Assigned Sections', value: assignments.length, color: '#534AB7' },
              { label: 'Hours Assigned', value: `${totalHours}h`, color: '#0F6E56' },
              { label: 'Hours Remaining', value: `${remainingHours}h`, color: remainingHours < 6 ? '#A32D2D' : '#1A1A2E' }
            ].map(card => (
              <div
                key={card.label}
                className="stat-card"
                style={{
                  background: 'white', borderRadius: 12, padding: 20,
                  border: '1px solid rgba(0,0,0,0.06)', boxShadow: 'var(--shadow-card)',
                  position: 'relative', overflow: 'hidden'
                }}
              >
                <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: card.color }} />
                <div style={{ fontSize: 12, fontWeight: 600, color: '#6B6B80', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>
                  {card.label}
                </div>
                <div style={{
                  fontSize: 36, fontWeight: 700, color: card.color,
                  backgroundImage: `linear-gradient(135deg, ${card.color}, ${card.color}cc)`,
                  WebkitBackgroundClip: 'text',
                  backgroundClip: 'text',
                  WebkitTextFillColor: 'transparent'
                }}>
                  {card.value}
                </div>
              </div>
            ))}
          </div>

          {/* Workload bar */}
          <div style={{ background: 'white', borderRadius: 12, padding: 20, border: '1px solid rgba(0,0,0,0.06)', boxShadow: 'var(--shadow-card)', marginBottom: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#6B6B80', marginBottom: 8 }}>
              <span style={{ fontWeight: 600 }}>Workload</span>
              <span>{totalHours}/{maxHours}h</span>
            </div>
            <div style={{ height: 8, background: '#f0f0f0', borderRadius: 4 }}>
              <div style={{
                height: 8,
                width: `${percent}%`,
                background: barColor,
                borderRadius: 4,
                transition: 'width 0.3s'
              }} />
            </div>
          </div>

          {/* Assignments table */}
          <div style={{ background: 'white', borderRadius: 12, border: '1px solid rgba(0,0,0,0.06)', boxShadow: 'var(--shadow-card)', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(0,0,0,0.07)' }}>
                  {['Course', 'Section', 'Term', 'Day / Time', 'Hours', 'Status'].map(h => (
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
                {assignments.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ padding: 24, textAlign: 'center', color: '#6B6B80' }}>
                      No assignments yet.
                    </td>
                  </tr>
                ) : assignments.map(a => (
                  <tr key={a.id} style={{ borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{ background: '#EEEDFE', color: '#534AB7', padding: '3px 10px', borderRadius: 20, fontSize: 13, fontWeight: 600 }}>
                        {a.section.course.code}
                      </span>
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: 14, color: '#1A1A2E' }}>
                      Section {a.section.section_number}
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: 14, color: '#6B6B80' }}>
                      {a.section.term.name}
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: 13, color: '#1A1A2E' }}>
                      {formatDayTime(a.section.day_of_week, a.section.time_slot)}
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: 14, color: '#1A1A2E' }}>
                      {a.hours_assigned}h
                    </td>
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
        </>
      )}
    </div>
  )
}