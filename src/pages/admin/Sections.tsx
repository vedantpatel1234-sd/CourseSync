import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { DAYS, TIME_SLOTS, formatDayTime } from '../../lib/schedule'
import toast from 'react-hot-toast'

interface Section {
  id: string
  section_number: string
  hours_required: number
  status: string
  day_of_week: string | null
  time_slot: string | null
  course: { code: string; name: string }
  term: { name: string }
}

interface Course {
  id: string
  code: string
  name: string
}

interface Term {
  id: string
  name: string
}

export default function AdminSections() {
  const [sections, setSections] = useState<Section[]>([])
  const [courses, setCourses] = useState<Course[]>([])
  const [terms, setTerms] = useState<Term[]>([])
  const [loading, setLoading] = useState(true)
  const [courseId, setCourseId] = useState('')
  const [termId, setTermId] = useState('')
  const [sectionNumber, setSectionNumber] = useState('')
  const [hoursRequired, setHoursRequired] = useState('3')
  const [dayOfWeek, setDayOfWeek] = useState('')
  const [timeSlot, setTimeSlot] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDay, setEditDay] = useState('')
  const [editTime, setEditTime] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)

  const fetchSections = async () => {
    const { data } = await supabase
      .from('sections')
      .select('*, course:courses(code, name), term:terms(name)')
      .order('created_at', { ascending: false })
    if (data) setSections(data as Section[])
    setLoading(false)
  }

  const fetchCoursesAndTerms = async () => {
    const { data: c } = await supabase.from('courses').select('id, code, name').order('code')
    const { data: t } = await supabase.from('terms').select('id, name').order('name')
    if (c) setCourses(c)
    if (t) setTerms(t)
  }

  useEffect(() => {
    fetchSections()
    fetchCoursesAndTerms()
  }, [])

  const validate = () => {
    const newErrors: Record<string, string> = {}
    if (!courseId) newErrors.courseId = 'Please select a course'
    if (!termId) newErrors.termId = 'Please select a term'
    if (!sectionNumber) newErrors.sectionNumber = 'Section number is required'
    const hours = parseInt(hoursRequired)
    if (!hours || hours < 1 || hours > 20) newErrors.hoursRequired = 'Hours must be between 1 and 20'
    if (!dayOfWeek) newErrors.dayOfWeek = 'Please select a day'
    if (!timeSlot) newErrors.timeSlot = 'Please select a time'
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!validate()) return
    const { error } = await supabase.from('sections').insert({
      course_id: courseId,
      term_id: termId,
      section_number: sectionNumber,
      hours_required: parseInt(hoursRequired),
      day_of_week: dayOfWeek,
      time_slot: timeSlot,
      status: 'unassigned'
    })
    if (error) {
      toast.error(error.message)
      return
    }
    toast.success('Section added!')
    setCourseId('')
    setTermId('')
    setSectionNumber('')
    setHoursRequired('3')
    setDayOfWeek('')
    setTimeSlot('')
    setErrors({})
    fetchSections()
  }

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from('sections').delete().eq('id', id)
    if (error) {
      toast.error(error.message)
      return
    }
    toast.success('Section deleted!')
    fetchSections()
  }

  const startEdit = (section: Section) => {
    setEditingId(section.id)
    setEditDay(section.day_of_week || '')
    setEditTime(section.time_slot || '')
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditDay('')
    setEditTime('')
  }

  const saveEdit = async (id: string) => {
    if (!editDay || !editTime) {
      toast.error('Please select both a day and a time')
      return
    }
    setSavingEdit(true)
    const { error } = await supabase
      .from('sections')
      .update({ day_of_week: editDay, time_slot: editTime })
      .eq('id', id)
    setSavingEdit(false)
    if (error) {
      toast.error(error.message)
      return
    }
    toast.success('Schedule updated!')
    cancelEdit()
    fetchSections()
  }

  const statusColors: Record<string, { color: string; bg: string }> = {
    unassigned: { color: '#A32D2D', bg: '#FCEBEB' },
    partial: { color: '#854F0B', bg: '#FAEEDA' },
    filled: { color: '#0F6E56', bg: '#EAF3DE' },
  }

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

  const smallSelectStyle = {
    padding: '6px 10px',
    borderRadius: 7,
    border: '1.5px solid #e5e7eb',
    fontSize: 13,
    fontFamily: 'DM Sans, sans-serif',
    outline: 'none',
    color: '#1A1A2E',
    background: 'white'
  }

  return (
    <div style={{ padding: 32, fontFamily: 'DM Sans, sans-serif' }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1A1A2E', marginBottom: 4 }}>
        Sections
      </h1>
      <p style={{ fontSize: 14, color: '#6B6B80', marginBottom: 32 }}>
        Manage course sections per term
      </p>

      {/* Add section form */}
      <div style={{
        background: 'white',
        borderRadius: 12,
        padding: 24,
        border: '1px solid rgba(0,0,0,0.07)',
        marginBottom: 24
      }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, color: '#1A1A2E', marginBottom: 16 }}>
          Add New Section
        </h2>
        <form onSubmit={handleAdd}>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#1A1A2E', marginBottom: 6 }}>
                Course
              </label>
              <select
                value={courseId}
                onChange={e => setCourseId(e.target.value)}
                style={{ ...inputStyle, borderColor: errors.courseId ? '#A32D2D' : '#e5e7eb' }}
              >
                <option value="">Select course...</option>
                {courses.map(c => (
                  <option key={c.id} value={c.id}>{c.code} — {c.name}</option>
                ))}
              </select>
              {errors.courseId && <p style={{ color: '#A32D2D', fontSize: 12, marginTop: 4 }}>{errors.courseId}</p>}
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#1A1A2E', marginBottom: 6 }}>
                Term
              </label>
              <select
                value={termId}
                onChange={e => setTermId(e.target.value)}
                style={{ ...inputStyle, borderColor: errors.termId ? '#A32D2D' : '#e5e7eb' }}
              >
                <option value="">Select term...</option>
                {terms.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
              {errors.termId && <p style={{ color: '#A32D2D', fontSize: 12, marginTop: 4 }}>{errors.termId}</p>}
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#1A1A2E', marginBottom: 6 }}>
                Section Number
              </label>
              <input
                value={sectionNumber}
                onChange={e => setSectionNumber(e.target.value)}
                placeholder="01"
                style={{ ...inputStyle, borderColor: errors.sectionNumber ? '#A32D2D' : '#e5e7eb' }}
              />
              {errors.sectionNumber && <p style={{ color: '#A32D2D', fontSize: 12, marginTop: 4 }}>{errors.sectionNumber}</p>}
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#1A1A2E', marginBottom: 6 }}>
                Hours Required
              </label>
              <input
                type="number"
                value={hoursRequired}
                onChange={e => setHoursRequired(e.target.value)}
                min={1}
                max={20}
                style={{ ...inputStyle, borderColor: errors.hoursRequired ? '#A32D2D' : '#e5e7eb' }}
              />
              {errors.hoursRequired && <p style={{ color: '#A32D2D', fontSize: 12, marginTop: 4 }}>{errors.hoursRequired}</p>}
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#1A1A2E', marginBottom: 6 }}>
                Day of Week
              </label>
              <select
                value={dayOfWeek}
                onChange={e => setDayOfWeek(e.target.value)}
                style={{ ...inputStyle, borderColor: errors.dayOfWeek ? '#A32D2D' : '#e5e7eb' }}
              >
                <option value="">Select day...</option>
                {DAYS.map(d => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
              {errors.dayOfWeek && <p style={{ color: '#A32D2D', fontSize: 12, marginTop: 4 }}>{errors.dayOfWeek}</p>}
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#1A1A2E', marginBottom: 6 }}>
                Time
              </label>
              <select
                value={timeSlot}
                onChange={e => setTimeSlot(e.target.value)}
                style={{ ...inputStyle, borderColor: errors.timeSlot ? '#A32D2D' : '#e5e7eb' }}
              >
                <option value="">Select time...</option>
                {TIME_SLOTS.map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              {errors.timeSlot && <p style={{ color: '#A32D2D', fontSize: 12, marginTop: 4 }}>{errors.timeSlot}</p>}
            </div>
          </div>
          <button
            type="submit"
            style={{
              padding: '10px 24px',
              background: '#534AB7',
              color: 'white',
              border: 'none',
              borderRadius: 9,
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'DM Sans, sans-serif'
            }}
          >
            Add Section
          </button>
        </form>
      </div>

      {/* Sections table */}
      <div style={{
        background: 'white',
        borderRadius: 12,
        border: '1px solid rgba(0,0,0,0.07)',
        overflow: 'hidden'
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid rgba(0,0,0,0.07)' }}>
              {['Course', 'Section', 'Term', 'Hours', 'Day / Time', 'Status', ''].map(h => (
                <th key={h} style={{
                  padding: '12px 16px',
                  textAlign: 'left',
                  fontSize: 12,
                  fontWeight: 600,
                  color: '#6B6B80',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px'
                }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} style={{ padding: 24, textAlign: 'center', color: '#6B6B80' }}>
                  Loading...
                </td>
              </tr>
            ) : sections.map(section => (
              <tr key={section.id} style={{ borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
                <td style={{ padding: '12px 16px' }}>
                  <span style={{
                    background: '#EEEDFE',
                    color: '#534AB7',
                    padding: '3px 10px',
                    borderRadius: 20,
                    fontSize: 13,
                    fontWeight: 600
                  }}>
                    {section.course.code}
                  </span>
                </td>
                <td style={{ padding: '12px 16px', fontSize: 14, color: '#1A1A2E' }}>
                  Section {section.section_number}
                </td>
                <td style={{ padding: '12px 16px', fontSize: 14, color: '#6B6B80' }}>
                  {section.term.name}
                </td>
                <td style={{ padding: '12px 16px', fontSize: 14, color: '#1A1A2E' }}>
                  {section.hours_required}h
                </td>
                <td style={{ padding: '12px 16px' }}>
                  {editingId === section.id ? (
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                      <select value={editDay} onChange={e => setEditDay(e.target.value)} style={smallSelectStyle}>
                        <option value="">Day...</option>
                        {DAYS.map(d => (
                          <option key={d} value={d}>{d}</option>
                        ))}
                      </select>
                      <select value={editTime} onChange={e => setEditTime(e.target.value)} style={smallSelectStyle}>
                        <option value="">Time...</option>
                        {TIME_SLOTS.map(t => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                      </select>
                      <button
                        onClick={() => saveEdit(section.id)}
                        disabled={savingEdit}
                        style={{
                          padding: '5px 10px', background: '#0F6E56', color: 'white',
                          border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 500,
                          cursor: savingEdit ? 'not-allowed' : 'pointer', fontFamily: 'DM Sans, sans-serif'
                        }}
                      >
                        Save
                      </button>
                      <button
                        onClick={cancelEdit}
                        style={{
                          padding: '5px 10px', background: '#f3f4f6', color: '#6B6B80',
                          border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 500,
                          cursor: 'pointer', fontFamily: 'DM Sans, sans-serif'
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <span style={{
                        fontSize: 13,
                        color: section.day_of_week && section.time_slot ? '#1A1A2E' : '#9ca3af',
                        fontStyle: section.day_of_week && section.time_slot ? 'normal' : 'italic'
                      }}>
                        {formatDayTime(section.day_of_week, section.time_slot)}
                      </span>
                      <button
                        onClick={() => startEdit(section)}
                        style={{
                          padding: '3px 9px', background: '#f3f4f6', color: '#534AB7',
                          border: 'none', borderRadius: 6, fontSize: 11, fontWeight: 500,
                          cursor: 'pointer', fontFamily: 'DM Sans, sans-serif'
                        }}
                      >
                        Edit
                      </button>
                    </div>
                  )}
                </td>
                <td style={{ padding: '12px 16px' }}>
                  <span style={{
                    background: statusColors[section.status]?.bg,
                    color: statusColors[section.status]?.color,
                    padding: '3px 10px',
                    borderRadius: 20,
                    fontSize: 12,
                    fontWeight: 600,
                    textTransform: 'capitalize'
                  }}>
                    {section.status}
                  </span>
                </td>
                <td style={{ padding: '12px 16px' }}>
                  <button
                    onClick={() => handleDelete(section.id)}
                    style={{
                      padding: '6px 14px',
                      background: '#FCEBEB',
                      color: '#A32D2D',
                      border: 'none',
                      borderRadius: 7,
                      fontSize: 13,
                      fontWeight: 500,
                      cursor: 'pointer',
                      fontFamily: 'DM Sans, sans-serif'
                    }}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
