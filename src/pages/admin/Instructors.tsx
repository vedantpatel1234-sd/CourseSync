import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../stores/authStore'
import { logAction } from '../../lib/audit'
import { notifyInstructor } from '../../lib/notifications'
import { parseResume, type QualificationSuggestion } from '../../lib/resumeParser'
import toast from 'react-hot-toast'
import { ChevronDown, ChevronUp, Upload } from 'lucide-react'

interface ManageInstructorResponse {
  id?: string
  password?: string
  success?: boolean
  error?: string
}

interface Qualification {
  id: string
  course_id: string
  verified: boolean
  course: { code: string; name: string }
}

interface Instructor {
  id: string
  full_name: string
  email: string
  instructor_profiles: {
    max_hours_per_term: number
    department: string
    title: string
  } | null
  hoursAssigned: number
  qualifications: Qualification[]
}

export default function AdminInstructors() {
  const { user } = useAuthStore()
  const [instructors, setInstructors] = useState<Instructor[]>([])
  const [loading, setLoading] = useState(true)
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [department, setDepartment] = useState('')
  const [title, setTitle] = useState('')
  const [maxHours, setMaxHours] = useState('40')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [adding, setAdding] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [parsingResume, setParsingResume] = useState(false)
  const [resumeFileName, setResumeFileName] = useState('')
  const [suggestedQuals, setSuggestedQuals] = useState<QualificationSuggestion[]>([])
  const [checkedQualIds, setCheckedQualIds] = useState<Set<string>>(new Set())
  const fileInputRef = useRef<HTMLInputElement>(null)

  const fetchInstructors = async () => {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('*, instructor_profiles(*)')
      .eq('role', 'instructor')
      .order('full_name')

    if (!profiles) {
      setLoading(false)
      return
    }

    const { data: assignments } = await supabase
      .from('assignments')
      .select('instructor_id, hours_assigned')
      .is('draft_id', null)
      .neq('status', 'rejected')

    const { data: qualifications } = await supabase
      .from('qualifications')
      .select('*, course:courses(code, name)')

    const result = profiles.map(p => ({
      ...p,
      hoursAssigned: assignments
        ? assignments.filter(a => a.instructor_id === p.id).reduce((sum, a) => sum + a.hours_assigned, 0)
        : 0,
      qualifications: qualifications
        ? qualifications.filter(q => q.instructor_id === p.id)
        : []
    }))

    setInstructors(result as Instructor[])
    setLoading(false)
  }

  useEffect(() => { fetchInstructors() }, [])

  const validate = () => {
    const newErrors: Record<string, string> = {}
    if (!fullName || fullName.length < 2) newErrors.fullName = 'Name must be at least 2 characters'
    if (!email || !/\S+@\S+\.\S+/.test(email)) newErrors.email = 'Valid email is required'
    if (!password || password.length < 8) newErrors.password = 'Password must be at least 8 characters'
    if (!/[A-Z]/.test(password)) newErrors.password = 'Password must contain an uppercase letter'
    if (!/[0-9]/.test(password)) newErrors.password = 'Password must contain a number'
    if (!department) newErrors.department = 'Department is required'
    if (!title) newErrors.title = 'Title is required'
    const hours = parseInt(maxHours)
    if (!hours || hours < 1 || hours > 100) newErrors.maxHours = 'Hours must be between 1 and 100'
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleResumeFile = async (file: File | undefined) => {
    if (!file) return
    setParsingResume(true)
    setResumeFileName(file.name)
    setSuggestedQuals([])
    setCheckedQualIds(new Set())

    try {
      const parsed = await parseResume(file)
      if (parsed.fullName && !fullName) setFullName(parsed.fullName)
      if (parsed.email && !email) setEmail(parsed.email)
      if (parsed.department && !department) setDepartment(parsed.department)
      if (parsed.title && !title) setTitle(parsed.title)
      if (parsed.maxHoursPerTerm) setMaxHours(String(parsed.maxHoursPerTerm))
      setSuggestedQuals(parsed.qualificationSuggestions)
      setCheckedQualIds(new Set(parsed.qualificationSuggestions.map(q => q.courseId)))
      toast.success('Resume parsed — review the pre-filled fields below.')
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'Unknown error'
      toast.error(`Could not parse resume: ${detail}`)
      setResumeFileName('')
    } finally {
      setParsingResume(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const toggleSuggestedQual = (courseId: string) => {
    setCheckedQualIds(prev => {
      const next = new Set(prev)
      if (next.has(courseId)) next.delete(courseId)
      else next.add(courseId)
      return next
    })
  }

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!validate()) return
    setAdding(true)

    const { data, error } = await supabase.functions.invoke<ManageInstructorResponse>('manage-instructor', {
      body: {
        action: 'create',
        full_name: fullName,
        email,
        password,
        department,
        title,
        max_hours_per_term: parseInt(maxHours)
      }
    })

    if (error || data?.error) {
      toast.error(data?.error || error!.message)
      setAdding(false)
      return
    }

    await logAction(user!.id, 'created', 'instructor', data!.id, { name: fullName, email })

    const qualsToAdd = suggestedQuals.filter(q => checkedQualIds.has(q.courseId))
    if (qualsToAdd.length > 0) {
      await supabase.from('qualifications').insert(
        qualsToAdd.map(q => ({ instructor_id: data!.id, course_id: q.courseId, verified: false }))
      )
    }

    toast.success('Instructor added!')
    setFullName('')
    setEmail('')
    setPassword('')
    setDepartment('')
    setTitle('')
    setMaxHours('40')
    setErrors({})
    setResumeFileName('')
    setSuggestedQuals([])
    setCheckedQualIds(new Set())
    setAdding(false)
    fetchInstructors()
  }

  const handleDelete = async (id: string) => {
    const name = instructors.find(i => i.id === id)?.full_name
    const { data, error } = await supabase.functions.invoke<ManageInstructorResponse>('manage-instructor', {
      body: { action: 'delete', instructor_id: id }
    })
    if (error || data?.error) {
      toast.error(data?.error || error!.message)
      return
    }
    await logAction(user!.id, 'deleted', 'instructor', id, { name })
    toast.success('Instructor deleted!')
    fetchInstructors()
  }

  const handleToggleVerify = async (qual: Qualification, instructorName: string, instructorId: string) => {
    const { error } = await supabase
      .from('qualifications')
      .update({ verified: !qual.verified })
      .eq('id', qual.id)

    if (error) {
      toast.error(error.message)
      return
    }

    await logAction(user!.id, qual.verified ? 'unverified' : 'verified', 'qualification', qual.id, {
      instructor: instructorName,
      course: qual.course.code
    })

    if (!qual.verified) {
      await notifyInstructor(
        instructorId,
        'notify_qualification_verified',
        `Your qualification for ${qual.course.code} — ${qual.course.name} was verified.`
      )
    }

    toast.success(qual.verified ? 'Qualification unverified' : 'Qualification verified!')
    fetchInstructors()
  }

  const getInitials = (name: string) =>
    name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)

  const inputStyle = {
    width: '100%',
    padding: '10px 14px',
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
      <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1A1A2E', marginBottom: 4 }}>
        Instructors
      </h1>
      <p style={{ fontSize: 14, color: '#6B6B80', marginBottom: 32 }}>
        Manage instructor accounts, workloads, and qualifications
      </p>

      <div style={{
        background: 'white', borderRadius: 12, padding: 24,
        border: '1px solid rgba(0,0,0,0.06)', boxShadow: 'var(--shadow-card)', marginBottom: 24
      }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, color: '#1A1A2E', marginBottom: 16 }}>
          Add New Instructor
        </h2>

        <div style={{
          background: '#EEEDFE', borderRadius: 10, padding: 16,
          marginBottom: 20, border: '1px solid rgba(83,74,183,0.2)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={parsingResume}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '8px 16px', background: parsingResume ? '#a09ad4' : 'linear-gradient(135deg, #6C5FD6, #534AB7)',
                color: 'white', border: 'none', borderRadius: 8,
                fontSize: 13, fontWeight: 600,
                cursor: parsingResume ? 'not-allowed' : 'pointer',
                fontFamily: 'DM Sans, sans-serif', flexShrink: 0
              }}
            >
              <Upload size={14} />
              {parsingResume ? 'Parsing...' : '✨ Parse Resume (PDF)'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf"
              onChange={e => handleResumeFile(e.target.files?.[0])}
              style={{ display: 'none' }}
            />
            <div style={{ fontSize: 13, color: '#534AB7' }}>
              {resumeFileName
                ? `${resumeFileName} — fields pre-filled below, review before adding.`
                : 'Optional — upload a PDF resume to auto-fill the fields below.'}
            </div>
          </div>

          {suggestedQuals.length > 0 && (
            <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid rgba(83,74,183,0.2)' }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#534AB7', marginBottom: 8 }}>
                Suggested qualifications — will be added as pending (unverified) on creation:
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {suggestedQuals.map(q => (
                  <label key={q.courseId} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={checkedQualIds.has(q.courseId)}
                      onChange={() => toggleSuggestedQual(q.courseId)}
                      style={{ marginTop: 3 }}
                    />
                    <span style={{ fontSize: 13, color: '#1A1A2E' }}>
                      <strong>{q.code}</strong> — {q.name}
                      <span style={{ color: '#6B6B80', fontStyle: 'italic' }}> ({q.reason})</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>

        <form onSubmit={handleAdd}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#1A1A2E', marginBottom: 6 }}>Full Name</label>
              <input value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Dr. Jane Smith"
                style={{ ...inputStyle, borderColor: errors.fullName ? '#A32D2D' : '#e5e7eb' }} />
              {errors.fullName && <p style={{ color: '#A32D2D', fontSize: 12, marginTop: 4 }}>{errors.fullName}</p>}
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#1A1A2E', marginBottom: 6 }}>Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="jane@university.ca"
                style={{ ...inputStyle, borderColor: errors.email ? '#A32D2D' : '#e5e7eb' }} />
              {errors.email && <p style={{ color: '#A32D2D', fontSize: 12, marginTop: 4 }}>{errors.email}</p>}
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#1A1A2E', marginBottom: 6 }}>Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Min 8 chars, 1 uppercase, 1 number"
                style={{ ...inputStyle, borderColor: errors.password ? '#A32D2D' : '#e5e7eb' }} />
              {errors.password && <p style={{ color: '#A32D2D', fontSize: 12, marginTop: 4 }}>{errors.password}</p>}
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#1A1A2E', marginBottom: 6 }}>Department</label>
              <input value={department} onChange={e => setDepartment(e.target.value)} placeholder="Computer Science"
                style={{ ...inputStyle, borderColor: errors.department ? '#A32D2D' : '#e5e7eb' }} />
              {errors.department && <p style={{ color: '#A32D2D', fontSize: 12, marginTop: 4 }}>{errors.department}</p>}
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#1A1A2E', marginBottom: 6 }}>Title</label>
              <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Associate Professor"
                style={{ ...inputStyle, borderColor: errors.title ? '#A32D2D' : '#e5e7eb' }} />
              {errors.title && <p style={{ color: '#A32D2D', fontSize: 12, marginTop: 4 }}>{errors.title}</p>}
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#1A1A2E', marginBottom: 6 }}>Max Hours / Term</label>
              <input type="number" value={maxHours} onChange={e => setMaxHours(e.target.value)} min={1} max={100}
                style={{ ...inputStyle, borderColor: errors.maxHours ? '#A32D2D' : '#e5e7eb' }} />
              {errors.maxHours && <p style={{ color: '#A32D2D', fontSize: 12, marginTop: 4 }}>{errors.maxHours}</p>}
            </div>
          </div>
          <button
            type="submit"
            disabled={adding}
            style={{
              padding: '10px 24px',
              background: adding ? '#a09ad4' : 'linear-gradient(135deg, #6C5FD6, #534AB7)',
              color: 'white', border: 'none', borderRadius: 9,
              fontSize: 14, fontWeight: 600,
              cursor: adding ? 'not-allowed' : 'pointer',
              fontFamily: 'DM Sans, sans-serif'
            }}
          >
            {adding ? 'Adding...' : 'Add Instructor'}
          </button>
        </form>
      </div>

      {loading ? (
        <p style={{ color: '#6B6B80' }}>Loading...</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {instructors.map(instructor => {
            const max = instructor.instructor_profiles?.max_hours_per_term || 40
            const percent = Math.min((instructor.hoursAssigned / max) * 100, 100)
            const barColor = percent >= 90 ? '#A32D2D' : percent >= 70 ? '#854F0B' : '#0F6E56'
            const isExpanded = expandedId === instructor.id

            return (
              <div key={instructor.id} style={{
                background: 'white', borderRadius: 12,
                border: '1px solid rgba(0,0,0,0.06)', boxShadow: 'var(--shadow-card)', overflow: 'hidden'
              }}>
                <div style={{
                  padding: 20,
                  display: 'flex', alignItems: 'center', gap: 16
                }}>
                  <div style={{
                    width: 44, height: 44, borderRadius: '50%',
                    background: 'linear-gradient(135deg, #6C5FD6, #534AB7)',
                    boxShadow: '0 2px 6px rgba(83,74,183,0.3)', color: 'white',
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
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : instructor.id)}
                    style={{
                      padding: '7px 14px', background: '#EEEDFE', color: '#534AB7',
                      border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 500,
                      cursor: 'pointer', fontFamily: 'DM Sans, sans-serif',
                      display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0
                    }}
                  >
                    Qualifications ({instructor.qualifications.length})
                    {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </button>
                  <button
                    onClick={() => handleDelete(instructor.id)}
                    style={{
                      padding: '6px 14px', background: '#FCEBEB', color: '#A32D2D',
                      border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 500,
                      cursor: 'pointer', fontFamily: 'DM Sans, sans-serif', flexShrink: 0
                    }}
                  >
                    Delete
                  </button>
                </div>

                {isExpanded && (
                  <div style={{ padding: '0 20px 20px', borderTop: '1px solid rgba(0,0,0,0.06)' }}>
                    {instructor.qualifications.length === 0 ? (
                      <p style={{ fontSize: 13, color: '#6B6B80', paddingTop: 16 }}>
                        No qualifications added yet.
                      </p>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 16 }}>
                        {instructor.qualifications.map(qual => (
                          <div key={qual.id} style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            padding: '10px 14px', background: '#F4F3F0', borderRadius: 8
                          }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{
                                background: '#EEEDFE', color: '#534AB7',
                                padding: '2px 8px', borderRadius: 20,
                                fontSize: 12, fontWeight: 600
                              }}>
                                {qual.course.code}
                              </span>
                              <span style={{ fontSize: 13, color: '#1A1A2E' }}>{qual.course.name}</span>
                            </div>
                            <button
                              onClick={() => handleToggleVerify(qual, instructor.full_name, instructor.id)}
                              style={{
                                padding: '5px 12px',
                                background: qual.verified ? '#EAF3DE' : '#FAEEDA',
                                color: qual.verified ? '#0F6E56' : '#854F0B',
                                border: 'none', borderRadius: 7,
                                fontSize: 12, fontWeight: 600,
                                cursor: 'pointer', fontFamily: 'DM Sans, sans-serif'
                              }}
                            >
                              {qual.verified ? '✓ Verified' : 'Verify'}
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}