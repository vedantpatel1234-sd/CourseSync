import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../stores/authStore'
import { logAction } from '../../lib/audit'
import toast from 'react-hot-toast'

interface Course {
  id: string
  code: string
  name: string
  description: string
}

export default function AdminCourses() {
  const { user } = useAuthStore()
  const [courses, setCourses] = useState<Course[]>([])
  const [loading, setLoading] = useState(true)
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [errors, setErrors] = useState<{ code?: string; name?: string }>({})

  const fetchCourses = async () => {
    const { data } = await supabase.from('courses').select('*').order('code')
    if (data) setCourses(data)
    setLoading(false)
  }

  useEffect(() => { fetchCourses() }, [])

  const validate = () => {
    const newErrors: { code?: string; name?: string } = {}
    if (!code) newErrors.code = 'Code is required'
    else if (!/^[A-Za-z0-9]+$/.test(code)) newErrors.code = 'Letters and numbers only'
    if (!name) newErrors.name = 'Name is required'
    else if (name.length < 3) newErrors.name = 'Name must be at least 3 characters'
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!validate()) return
    const { error } = await supabase.from('courses').insert({ code, name, description })
    if (error) {
      toast.error(error.message)
      return
    }
    await logAction(user!.id, 'created', 'course', undefined, { code, name })
    toast.success('Course added!')
    setCode('')
    setName('')
    setDescription('')
    setErrors({})
    fetchCourses()
  }

  const handleDelete = async (id: string) => {
    const courseCode = courses.find(c => c.id === id)?.code
    const { error } = await supabase.from('courses').delete().eq('id', id)
    if (error) {
      if (error.code === '23503') {
        toast.error(`Can't delete ${courseCode} — it still has sections. Delete or reassign those sections first.`)
      } else {
        toast.error(error.message)
      }
      return
    }
    await logAction(user!.id, 'deleted', 'course', id, { code: courseCode })
    toast.success('Course deleted!')
    fetchCourses()
  }

  const inputStyle = {
    width: '100%',
    padding: '10px 14px',
    borderRadius: 9,
    border: '1.5px solid #e5e7eb',
    fontSize: 14,
    fontFamily: 'DM Sans, sans-serif',
    outline: 'none',
    color: '#1A1A2E'
  }

  return (
    <div style={{ padding: 32, fontFamily: 'DM Sans, sans-serif' }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1A1A2E', marginBottom: 4 }}>
        Courses
      </h1>
      <p style={{ fontSize: 14, color: '#6B6B80', marginBottom: 32 }}>
        Manage your course catalog
      </p>

      <div style={{
        background: 'white', borderRadius: 12, padding: 24,
        border: '1px solid rgba(0,0,0,0.07)', marginBottom: 24
      }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, color: '#1A1A2E', marginBottom: 16 }}>
          Add New Course
        </h2>
        <form onSubmit={handleAdd}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 2fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#1A1A2E', marginBottom: 6 }}>Code</label>
              <input
                value={code}
                onChange={e => setCode(e.target.value)}
                placeholder="COMP1234"
                style={{ ...inputStyle, borderColor: errors.code ? '#A32D2D' : '#e5e7eb' }}
              />
              {errors.code && <p style={{ color: '#A32D2D', fontSize: 12, marginTop: 4 }}>{errors.code}</p>}
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#1A1A2E', marginBottom: 6 }}>Name</label>
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Introduction to Programming"
                style={{ ...inputStyle, borderColor: errors.name ? '#A32D2D' : '#e5e7eb' }}
              />
              {errors.name && <p style={{ color: '#A32D2D', fontSize: 12, marginTop: 4 }}>{errors.name}</p>}
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#1A1A2E', marginBottom: 6 }}>Description (optional)</label>
              <input
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="Brief description..."
                style={inputStyle}
              />
            </div>
          </div>
          <button
            type="submit"
            style={{
              padding: '10px 24px', background: '#534AB7', color: 'white',
              border: 'none', borderRadius: 9, fontSize: 14, fontWeight: 600,
              cursor: 'pointer', fontFamily: 'DM Sans, sans-serif'
            }}
          >
            Add Course
          </button>
        </form>
      </div>

      <div style={{ background: 'white', borderRadius: 12, border: '1px solid rgba(0,0,0,0.07)', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid rgba(0,0,0,0.07)' }}>
              {['Code', 'Name', 'Description', ''].map(h => (
                <th key={h} style={{
                  padding: '12px 16px', textAlign: 'left', fontSize: 12,
                  fontWeight: 600, color: '#6B6B80', textTransform: 'uppercase', letterSpacing: '0.5px'
                }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={4} style={{ padding: 24, textAlign: 'center', color: '#6B6B80' }}>Loading...</td></tr>
            ) : courses.map(course => (
              <tr key={course.id} style={{ borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
                <td style={{ padding: '12px 16px' }}>
                  <span style={{ background: '#EEEDFE', color: '#534AB7', padding: '3px 10px', borderRadius: 20, fontSize: 13, fontWeight: 600 }}>
                    {course.code}
                  </span>
                </td>
                <td style={{ padding: '12px 16px', fontSize: 14, color: '#1A1A2E' }}>{course.name}</td>
                <td style={{ padding: '12px 16px', fontSize: 14, color: '#6B6B80' }}>{course.description || '—'}</td>
                <td style={{ padding: '12px 16px' }}>
                  <button
                    onClick={() => handleDelete(course.id)}
                    style={{
                      padding: '6px 14px', background: '#FCEBEB', color: '#A32D2D',
                      border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 500,
                      cursor: 'pointer', fontFamily: 'DM Sans, sans-serif'
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