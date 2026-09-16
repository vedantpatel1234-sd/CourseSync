import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../stores/authStore'
import { logAction } from '../../lib/audit'
import toast from 'react-hot-toast'

interface Term {
  id: string
  name: string
  start_date: string
  end_date: string
  is_active: boolean
}

export default function AdminTerms() {
  const { user } = useAuthStore()
  const [terms, setTerms] = useState<Term[]>([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [errors, setErrors] = useState<{ name?: string; startDate?: string; endDate?: string }>({})
  const [adding, setAdding] = useState(false)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editStart, setEditStart] = useState('')
  const [editEnd, setEditEnd] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)

  const fetchTerms = async () => {
    const { data } = await supabase.from('terms').select('*').order('start_date')
    if (data) setTerms(data)
    setLoading(false)
  }

  useEffect(() => { fetchTerms() }, [])

  const validate = () => {
    const newErrors: { name?: string; startDate?: string; endDate?: string } = {}
    if (!name || name.length < 2) newErrors.name = 'Name is required'
    if (!startDate) newErrors.startDate = 'Start date is required'
    if (!endDate) newErrors.endDate = 'End date is required'
    if (startDate && endDate && endDate <= startDate) newErrors.endDate = 'End date must be after start date'
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!validate()) return
    setAdding(true)

    const { error } = await supabase.from('terms').insert({
      name, start_date: startDate, end_date: endDate, is_active: false
    })
    if (error) {
      toast.error(error.message)
      setAdding(false)
      return
    }
    await logAction(user!.id, 'created', 'term', undefined, { name })
    toast.success('Term added!')
    setName('')
    setStartDate('')
    setEndDate('')
    setErrors({})
    setAdding(false)
    fetchTerms()
  }

  const handleSetActive = async (term: Term) => {
    await supabase.from('terms').update({ is_active: false }).neq('id', term.id)
    const { error } = await supabase.from('terms').update({ is_active: true }).eq('id', term.id)
    if (error) {
      toast.error(error.message)
      return
    }
    await logAction(user!.id, 'activated', 'term', term.id, { name: term.name })
    toast.success(`${term.name} is now the active term`)
    fetchTerms()
  }

  const startEdit = (term: Term) => {
    setEditingId(term.id)
    setEditName(term.name)
    setEditStart(term.start_date)
    setEditEnd(term.end_date)
  }

  const handleSaveEdit = async (id: string) => {
    if (!editName || editName.length < 2 || !editStart || !editEnd || editEnd <= editStart) {
      toast.error('Please check the name and dates')
      return
    }
    setSavingEdit(true)
    const { error } = await supabase
      .from('terms')
      .update({ name: editName, start_date: editStart, end_date: editEnd })
      .eq('id', id)
    setSavingEdit(false)
    if (error) {
      toast.error(error.message)
      return
    }
    await logAction(user!.id, 'edited', 'term', id, { name: editName })
    toast.success('Term updated!')
    setEditingId(null)
    fetchTerms()
  }

  const handleDelete = async (term: Term) => {
    const { error } = await supabase.from('terms').delete().eq('id', term.id)
    if (error) {
      if (error.code === '23503') {
        toast.error(`Can't delete ${term.name} — it still has sections. Delete or reassign those sections first.`)
      } else {
        toast.error(error.message)
      }
      return
    }
    await logAction(user!.id, 'deleted', 'term', term.id, { name: term.name })
    toast.success('Term deleted!')
    fetchTerms()
  }

  const formatDate = (dateStr: string) =>
    new Date(dateStr + 'T00:00:00').toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })

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
        Terms
      </h1>
      <p style={{ fontSize: 14, color: '#6B6B80', marginBottom: 32 }}>
        Manage academic terms — the active term is the default everywhere a term isn't explicitly chosen
      </p>

      <div style={{
        background: 'white', borderRadius: 12, padding: 24,
        border: '1px solid rgba(0,0,0,0.06)', boxShadow: 'var(--shadow-card)', marginBottom: 24
      }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, color: '#1A1A2E', marginBottom: 16 }}>
          Add New Term
        </h2>
        <form onSubmit={handleAdd}>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#1A1A2E', marginBottom: 6 }}>Name</label>
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Fall 2026"
                style={{ ...inputStyle, borderColor: errors.name ? '#A32D2D' : '#e5e7eb' }}
              />
              {errors.name && <p style={{ color: '#A32D2D', fontSize: 12, marginTop: 4 }}>{errors.name}</p>}
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#1A1A2E', marginBottom: 6 }}>Start Date</label>
              <input
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                style={{ ...inputStyle, borderColor: errors.startDate ? '#A32D2D' : '#e5e7eb' }}
              />
              {errors.startDate && <p style={{ color: '#A32D2D', fontSize: 12, marginTop: 4 }}>{errors.startDate}</p>}
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#1A1A2E', marginBottom: 6 }}>End Date</label>
              <input
                type="date"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
                style={{ ...inputStyle, borderColor: errors.endDate ? '#A32D2D' : '#e5e7eb' }}
              />
              {errors.endDate && <p style={{ color: '#A32D2D', fontSize: 12, marginTop: 4 }}>{errors.endDate}</p>}
            </div>
          </div>
          <button
            type="submit"
            disabled={adding}
            style={{
              padding: '10px 24px',
              background: adding ? '#a09ad4' : 'linear-gradient(135deg, #6C5FD6, #534AB7)',
              color: 'white', border: 'none', borderRadius: 9, fontSize: 14, fontWeight: 600,
              cursor: adding ? 'not-allowed' : 'pointer', fontFamily: 'DM Sans, sans-serif'
            }}
          >
            {adding ? 'Adding...' : 'Add Term'}
          </button>
        </form>
      </div>

      <div style={{ background: 'white', borderRadius: 12, border: '1px solid rgba(0,0,0,0.06)', boxShadow: 'var(--shadow-card)', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid rgba(0,0,0,0.07)' }}>
              {['Name', 'Start', 'End', 'Status', ''].map(h => (
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
              <tr><td colSpan={5} style={{ padding: 24, textAlign: 'center', color: '#6B6B80' }}>Loading...</td></tr>
            ) : terms.length === 0 ? (
              <tr><td colSpan={5} style={{ padding: 24, textAlign: 'center', color: '#6B6B80' }}>No terms yet. Add one above.</td></tr>
            ) : terms.map(term => {
              const isEditing = editingId === term.id
              return (
                <tr key={term.id} style={{ borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
                  {isEditing ? (
                    <>
                      <td style={{ padding: '10px 16px' }}>
                        <input value={editName} onChange={e => setEditName(e.target.value)} style={{ ...inputStyle, padding: '6px 10px', fontSize: 13 }} />
                      </td>
                      <td style={{ padding: '10px 16px' }}>
                        <input type="date" value={editStart} onChange={e => setEditStart(e.target.value)} style={{ ...inputStyle, padding: '6px 10px', fontSize: 13 }} />
                      </td>
                      <td style={{ padding: '10px 16px' }}>
                        <input type="date" value={editEnd} onChange={e => setEditEnd(e.target.value)} style={{ ...inputStyle, padding: '6px 10px', fontSize: 13 }} />
                      </td>
                      <td style={{ padding: '10px 16px' }} colSpan={2}>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button
                            onClick={() => handleSaveEdit(term.id)}
                            disabled={savingEdit}
                            style={{
                              padding: '6px 14px', background: savingEdit ? '#a09ad4' : 'linear-gradient(135deg, #6C5FD6, #534AB7)',
                              color: 'white', border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 500,
                              cursor: savingEdit ? 'not-allowed' : 'pointer', fontFamily: 'DM Sans, sans-serif'
                            }}
                          >
                            Save
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            style={{
                              padding: '6px 14px', background: '#f3f4f6', color: '#6B6B80',
                              border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 500,
                              cursor: 'pointer', fontFamily: 'DM Sans, sans-serif'
                            }}
                          >
                            Cancel
                          </button>
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td style={{ padding: '12px 16px', fontSize: 14, color: '#1A1A2E', fontWeight: 500 }}>{term.name}</td>
                      <td style={{ padding: '12px 16px', fontSize: 13, color: '#6B6B80' }}>{formatDate(term.start_date)}</td>
                      <td style={{ padding: '12px 16px', fontSize: 13, color: '#6B6B80' }}>{formatDate(term.end_date)}</td>
                      <td style={{ padding: '12px 16px' }}>
                        {term.is_active ? (
                          <span style={{ background: '#EAF3DE', color: '#0F6E56', padding: '3px 10px', borderRadius: 20, fontSize: 12, fontWeight: 600 }}>
                            ✓ Active
                          </span>
                        ) : (
                          <button
                            onClick={() => handleSetActive(term)}
                            style={{
                              padding: '4px 12px', background: '#EEEDFE', color: '#534AB7',
                              border: 'none', borderRadius: 20, fontSize: 12, fontWeight: 600,
                              cursor: 'pointer', fontFamily: 'DM Sans, sans-serif'
                            }}
                          >
                            Set Active
                          </button>
                        )}
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button
                            onClick={() => startEdit(term)}
                            style={{
                              padding: '6px 14px', background: '#EEEDFE', color: '#534AB7',
                              border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 500,
                              cursor: 'pointer', fontFamily: 'DM Sans, sans-serif'
                            }}
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleDelete(term)}
                            style={{
                              padding: '6px 14px', background: '#FCEBEB', color: '#A32D2D',
                              border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 500,
                              cursor: 'pointer', fontFamily: 'DM Sans, sans-serif'
                            }}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
