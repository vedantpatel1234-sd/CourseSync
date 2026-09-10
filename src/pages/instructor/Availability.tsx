import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../stores/authStore'
import { DAYS, TIME_SLOTS } from '../../lib/schedule'
import toast from 'react-hot-toast'

interface ClassInfo {
  courseCode: string
  sectionNumber: string
}

export default function InstructorAvailability() {
  const { user } = useAuthStore()
  const [unavailable, setUnavailable] = useState<Set<string>>(new Set())
  const [classByKey, setClassByKey] = useState<Map<string, ClassInfo>>(new Map())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const fetchAvailability = async () => {
      if (!user) return

      const { data: availabilityData } = await supabase
        .from('instructor_availability')
        .select('*')
        .eq('instructor_id', user.id)

      if (availabilityData) {
        const keys = new Set(availabilityData.map(a => `${a.day}-${a.time_slot}`))
        setUnavailable(keys)
      }

      const { data: assignmentsData } = await supabase
        .from('assignments')
        .select('section:sections!assignments_section_id_fkey(day_of_week, time_slot, section_number, course:courses(code))')
        .eq('instructor_id', user.id)
        .is('draft_id', null)
        .neq('status', 'rejected')

      if (assignmentsData) {
        const rows = assignmentsData as unknown as {
          section: { day_of_week: string | null; time_slot: string | null; section_number: string; course: { code: string } }
        }[]
        const map = new Map<string, ClassInfo>()
        for (const row of rows) {
          const { day_of_week, time_slot, section_number, course } = row.section
          if (day_of_week && time_slot) {
            map.set(`${day_of_week}-${time_slot}`, { courseCode: course.code, sectionNumber: section_number })
          }
        }
        setClassByKey(map)
      }

      setLoading(false)
    }
    fetchAvailability()
  }, [user])

  const toggleSlot = (day: string, slot: string) => {
    const key = `${day}-${slot}`
    if (classByKey.has(key)) return // can't override a real scheduled class
    setUnavailable(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const handleSave = async () => {
    if (!user) return
    setSaving(true)

    await supabase
      .from('instructor_availability')
      .delete()
      .eq('instructor_id', user.id)

    if (unavailable.size > 0) {
      const rows = Array.from(unavailable).map(key => {
        const [day, ...rest] = key.split('-')
        return {
          instructor_id: user.id,
          day,
          time_slot: rest.join('-')
        }
      })
      await supabase.from('instructor_availability').insert(rows)
    }

    toast.success('Availability saved!')
    setSaving(false)
  }

  if (loading) return <div style={{ padding: 32, fontFamily: 'DM Sans, sans-serif', color: '#6B6B80' }}>Loading...</div>

  return (
    <div style={{ padding: 32, fontFamily: 'DM Sans, sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 32 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1A1A2E', marginBottom: 4 }}>
            Availability
          </h1>
          <p style={{ fontSize: 14, color: '#6B6B80' }}>
            Click a slot to mark it as unavailable. Slots where you're already teaching are filled in for you automatically.
          </p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            padding: '10px 24px',
            background: saving ? '#a09ad4' : '#534AB7',
            color: 'white',
            border: 'none',
            borderRadius: 9,
            fontSize: 14,
            fontWeight: 600,
            cursor: saving ? 'not-allowed' : 'pointer',
            fontFamily: 'DM Sans, sans-serif'
          }}
        >
          {saving ? 'Saving...' : 'Save Availability'}
        </button>
      </div>

      <div style={{ display: 'flex', gap: 20, marginBottom: 16 }}>
        {[
          { label: 'Available', color: '#6B6B80', bg: '#f8f8f8' },
          { label: 'Unavailable', color: '#A32D2D', bg: '#FCEBEB' },
          { label: 'Teaching (automatic)', color: '#534AB7', bg: '#EEEDFE' }
        ].map(item => (
          <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 14, height: 14, borderRadius: 4, background: item.bg, border: `1px solid ${item.color}` }} />
            <span style={{ fontSize: 12, color: '#6B6B80' }}>{item.label}</span>
          </div>
        ))}
      </div>

      <div style={{ background: 'white', borderRadius: 12, border: '1px solid rgba(0,0,0,0.07)', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid rgba(0,0,0,0.07)' }}>
              <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: '#6B6B80', width: 100 }}>
                Time
              </th>
              {DAYS.map(day => (
                <th key={day} style={{ padding: '12px 16px', textAlign: 'center', fontSize: 12, fontWeight: 600, color: '#6B6B80' }}>
                  {day}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {TIME_SLOTS.map(slot => (
              <tr key={slot} style={{ borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
                <td style={{ padding: '10px 16px', fontSize: 13, color: '#6B6B80', fontWeight: 500 }}>
                  {slot}
                </td>
                {DAYS.map(day => {
                  const key = `${day}-${slot}`
                  const classInfo = classByKey.get(key)
                  const isUnavailable = unavailable.has(key)
                  return (
                    <td key={day} style={{ padding: '6px 16px', textAlign: 'center' }}>
                      <button
                        onClick={() => toggleSlot(day, slot)}
                        disabled={!!classInfo}
                        title={classInfo ? `Teaching ${classInfo.courseCode} — Section ${classInfo.sectionNumber}` : undefined}
                        style={{
                          width: '100%',
                          padding: '8px 0',
                          borderRadius: 6,
                          border: 'none',
                          background: classInfo ? '#EEEDFE' : isUnavailable ? '#FCEBEB' : '#f8f8f8',
                          color: classInfo ? '#534AB7' : isUnavailable ? '#A32D2D' : '#9ca3af',
                          fontSize: 12,
                          fontWeight: 500,
                          cursor: classInfo ? 'default' : 'pointer',
                          fontFamily: 'DM Sans, sans-serif',
                          transition: 'all 0.15s',
                          lineHeight: 1.3
                        }}
                      >
                        {classInfo
                          ? <>{classInfo.courseCode}<br />§{classInfo.sectionNumber}</>
                          : isUnavailable ? 'Unavailable' : 'Available'}
                      </button>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}