import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

interface Instructor {
  id: string
  full_name: string
  email: string
  hoursAssigned: number
  instructor_profiles: {
    max_hours_per_term: number
    department: string
    title: string
  } | null
}

export default function CoordinatorInstructors() {
  const [instructors, setInstructors] = useState<Instructor[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchInstructors = async () => {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('*, instructor_profiles(*)')
        .eq('role', 'instructor')
        .order('full_name')

      const { data: assignments } = await supabase
        .from('assignments')
        .select('instructor_id, hours_assigned')
        .is('draft_id', null)
        .neq('status', 'rejected')

      if (profiles) {
        const result = profiles.map(p => ({
          ...p,
          hoursAssigned: assignments
            ? assignments.filter(a => a.instructor_id === p.id).reduce((sum, a) => sum + a.hours_assigned, 0)
            : 0
        }))
        setInstructors(result as Instructor[])
      }
      setLoading(false)
    }
    fetchInstructors()
  }, [])

  const getInitials = (name: string) =>
    name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)

  return (
    <div style={{ padding: 32, fontFamily: 'DM Sans, sans-serif' }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1A1A2E', marginBottom: 4 }}>
        Instructors
      </h1>
      <p style={{ fontSize: 14, color: '#6B6B80', marginBottom: 32 }}>
        View instructor workloads — read only
      </p>

      {loading ? (
        <p style={{ color: '#6B6B80' }}>Loading...</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {instructors.map(instructor => {
            const max = instructor.instructor_profiles?.max_hours_per_term || 40
            const percent = Math.min((instructor.hoursAssigned / max) * 100, 100)
            const barColor = percent >= 90 ? '#A32D2D' : percent >= 70 ? '#854F0B' : '#0F6E56'

            return (
              <div key={instructor.id} style={{
                background: 'white', borderRadius: 12, padding: 20,
                border: '1px solid rgba(0,0,0,0.07)',
                display: 'flex', alignItems: 'center', gap: 16
              }}>
                <div style={{
                  width: 44, height: 44, borderRadius: '50%',
                  background: '#534AB7', color: 'white',
                  display: 'flex', alignItems: 'center',
                  justifyContent: 'center', fontSize: 14,
                  fontWeight: 700, flexShrink: 0
                }}>
                  {getInitials(instructor.full_name)}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 15, fontWeight: 600, color: '#1A1A2E' }}>{instructor.full_name}</div>
                  <div style={{ fontSize: 13, color: '#6B6B80' }}>{instructor.email}</div>
                  {instructor.instructor_profiles && (
                    <div style={{ fontSize: 12, color: '#6B6B80', marginTop: 2 }}>
                      {instructor.instructor_profiles.title} — {instructor.instructor_profiles.department}
                    </div>
                  )}
                </div>
                <div style={{ width: 180 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#6B6B80', marginBottom: 4 }}>
                    <span>Workload</span>
                    <span>{instructor.hoursAssigned}/{max}h</span>
                  </div>
                  <div style={{ height: 6, background: '#f0f0f0', borderRadius: 3 }}>
                    <div style={{
                      height: 6, width: `${percent}%`,
                      background: barColor, borderRadius: 3,
                      transition: 'width 0.3s'
                    }} />
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}