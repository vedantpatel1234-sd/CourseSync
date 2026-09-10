import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../stores/authStore'
import toast from 'react-hot-toast'

interface Course {
  id: string
  code: string
  name: string
}

interface Qualification {
  id: string
  course_id: string
  verified: boolean
}

export default function InstructorQualifications() {
  const { user } = useAuthStore()
  const [courses, setCourses] = useState<Course[]>([])
  const [qualifications, setQualifications] = useState<Qualification[]>([])
  const [loading, setLoading] = useState(true)

  const fetchData = async () => {
    if (!user) return
    const { data: coursesData } = await supabase
      .from('courses')
      .select('*')
      .order('code')

    const { data: qualsData } = await supabase
      .from('qualifications')
      .select('*')
      .eq('instructor_id', user.id)

    if (coursesData) setCourses(coursesData)
    if (qualsData) setQualifications(qualsData)
    setLoading(false)
  }

  useEffect(() => { fetchData() }, [user])

  const getQual = (courseId: string) =>
    qualifications.find(q => q.course_id === courseId)

  const handleToggle = async (courseId: string) => {
    if (!user) return
    const existing = getQual(courseId)

    if (existing) {
      await supabase.from('qualifications').delete().eq('id', existing.id)
      toast.success('Qualification removed')
    } else {
      await supabase.from('qualifications').insert({
        instructor_id: user.id,
        course_id: courseId,
        verified: false
      })
      toast.success('Qualification added — pending verification')
    }
    fetchData()
  }

  const verified = qualifications.filter(q => q.verified).length
  const pending = qualifications.filter(q => !q.verified).length

  return (
    <div style={{ padding: 32, fontFamily: 'DM Sans, sans-serif' }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1A1A2E', marginBottom: 4 }}>
        Qualifications
      </h1>
      <p style={{ fontSize: 14, color: '#6B6B80', marginBottom: 32 }}>
        Select the courses you are qualified to teach
      </p>

      {loading ? <p style={{ color: '#6B6B80' }}>Loading...</p> : (
        <>
          {/* Stat cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 24 }}>
            {[
              { label: 'Total', value: qualifications.length, color: '#534AB7', bg: '#EEEDFE' },
              { label: 'Verified', value: verified, color: '#0F6E56', bg: '#EAF3DE' },
              { label: 'Pending', value: pending, color: '#854F0B', bg: '#FAEEDA' },
            ].map(card => (
              <div key={card.label} style={{ background: 'white', borderRadius: 12, padding: 20, border: '1px solid rgba(0,0,0,0.07)' }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#6B6B80', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>
                  {card.label}
                </div>
                <div style={{ fontSize: 36, fontWeight: 700, color: card.color }}>
                  {card.value}
                </div>
              </div>
            ))}
          </div>

          {/* Courses grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
            {courses.map(course => {
              const qual = getQual(course.id)
              const hasQual = !!qual
              const isVerified = qual?.verified || false

              return (
                <div
                  key={course.id}
                  style={{
                    background: 'white',
                    borderRadius: 12,
                    padding: 16,
                    border: `1px solid ${hasQual ? 'rgba(83,74,183,0.2)' : 'rgba(0,0,0,0.07)'}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12
                  }}
                >
                  <div>
                    <span style={{
                      background: '#EEEDFE', color: '#534AB7',
                      padding: '2px 8px', borderRadius: 20,
                      fontSize: 12, fontWeight: 600,
                      display: 'inline-block', marginBottom: 4
                    }}>
                      {course.code}
                    </span>
                    <div style={{ fontSize: 13, color: '#1A1A2E', fontWeight: 500 }}>
                      {course.name}
                    </div>
                    {hasQual && (
                      <span style={{
                        fontSize: 11, fontWeight: 600,
                        color: isVerified ? '#0F6E56' : '#854F0B',
                        background: isVerified ? '#EAF3DE' : '#FAEEDA',
                        padding: '2px 8px', borderRadius: 20,
                        display: 'inline-block', marginTop: 4
                      }}>
                        {isVerified ? '✓ Verified' : '⏳ Pending'}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => handleToggle(course.id)}
                    style={{
                      padding: '6px 14px',
                      background: hasQual ? '#FCEBEB' : '#EEEDFE',
                      color: hasQual ? '#A32D2D' : '#534AB7',
                      border: 'none', borderRadius: 7,
                      fontSize: 13, fontWeight: 500,
                      cursor: 'pointer', fontFamily: 'DM Sans, sans-serif',
                      flexShrink: 0
                    }}
                  >
                    {hasQual ? 'Remove' : 'Add'}
                  </button>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}