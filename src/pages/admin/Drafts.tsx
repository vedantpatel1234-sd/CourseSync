import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../stores/authStore'
import { logAction } from '../../lib/audit'
import { runAutoScheduler, type RejectedItem } from '../../lib/autoScheduler'
import toast from 'react-hot-toast'

interface Draft {
  id: string
  name: string
  status: 'sandbox' | 'published'
  is_ai_generated: boolean
  created_at: string
  published_at: string | null
  term: { name: string }
  created_by_profile: { full_name: string }
}

interface Term {
  id: string
  name: string
}

export default function AdminDrafts() {
  const { user } = useAuthStore()
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [terms, setTerms] = useState<Term[]>([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [termId, setTermId] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [adding, setAdding] = useState(false)
  const [aiTermId, setAiTermId] = useState('')
  const [generating, setGenerating] = useState(false)
  const [aiResult, setAiResult] = useState<{ draftId: string; draftName: string; acceptedCount: number; rejected: RejectedItem[] } | null>(null)

  const fetchData = async () => {
    const { data: draftsData } = await supabase
      .from('drafts')
      .select('*, term:terms(name), created_by_profile:profiles!drafts_created_by_fkey(full_name)')
      .order('created_at', { ascending: false })

    const { data: termsData } = await supabase
      .from('terms')
      .select('id, name')
      .order('name')

    if (draftsData) setDrafts(draftsData as Draft[])
    if (termsData) setTerms(termsData)
    setLoading(false)
  }

  useEffect(() => { fetchData() }, [])

  const validate = () => {
    const newErrors: Record<string, string> = {}
    if (!name || name.length < 2) newErrors.name = 'Name must be at least 2 characters'
    if (name.length > 100) newErrors.name = 'Name too long'
    if (!termId) newErrors.termId = 'Please select a term'
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!validate()) return
    setAdding(true)

    const { error } = await supabase.from('drafts').insert({
      name,
      term_id: termId,
      created_by: user?.id,
      status: 'sandbox',
      is_ai_generated: false
    })

    if (error) {
      toast.error(error.message)
      setAdding(false)
      return
    }

    await logAction(user!.id, 'created', 'draft', undefined, { name })
    toast.success('Draft created!')
    setName('')
    setTermId('')
    setErrors({})
    setAdding(false)
    fetchData()
  }

  const handleGenerateAi = async () => {
    if (!aiTermId || !user) {
      toast.error('Please select a term')
      return
    }
    setGenerating(true)
    setAiResult(null)

    try {
      const result = await runAutoScheduler(aiTermId)
      const term = terms.find(t => t.id === aiTermId)
      const termName = term?.name || 'Unknown Term'

      if (result.noSectionsFound) {
        toast(`All sections in ${termName} are already assigned!`, { icon: 'ℹ️' })
        setGenerating(false)
        return
      }

      if (result.accepted.length === 0) {
        toast.error('The AI could not confidently assign any section — see reasons below.')
        setAiResult({ draftId: '', draftName: '', acceptedCount: 0, rejected: result.rejected })
        setGenerating(false)
        return
      }

      const dateStr = new Date().toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })
      const draftName = `AI Draft — ${termName} — ${dateStr}`

      const { data: newDraft, error: draftError } = await supabase
        .from('drafts')
        .insert({ name: draftName, term_id: aiTermId, created_by: user.id, status: 'sandbox', is_ai_generated: true })
        .select('id')
        .single()

      if (draftError || !newDraft) {
        toast.error(draftError?.message || 'Failed to create draft')
        setGenerating(false)
        return
      }

      const { error: insertError } = await supabase.from('assignments').insert(
        result.accepted.map(a => ({
          instructor_id: a.instructorId,
          section_id: a.sectionId,
          hours_assigned: a.hours,
          assigned_by: user.id,
          status: 'active',
          draft_id: newDraft.id,
          ai_rationale: a.rationale
        }))
      )

      if (insertError) {
        toast.error(insertError.message)
        setGenerating(false)
        return
      }

      await logAction(user.id, 'ai_generated', 'draft', newDraft.id, {
        count: result.accepted.length,
        rejected: result.rejected.length,
        term: termName
      })

      toast.success(`Generated ${result.accepted.length} assignment(s)!`)
      setAiResult({ draftId: newDraft.id, draftName, acceptedCount: result.accepted.length, rejected: result.rejected })
      setAiTermId('')
      fetchData()
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'Unknown error'
      toast.error(`AI scheduling failed: ${detail}`)
    } finally {
      setGenerating(false)
    }
  }

  const handleDelete = async (draft: Draft) => {
    // Drafts can now hold real assignment rows (draft_id = this draft), so clear
    // those out first rather than relying on unknown FK cascade behavior.
    const { error: assignError } = await supabase.from('assignments').delete().eq('draft_id', draft.id)
    if (assignError) {
      toast.error(assignError.message)
      return
    }

    const { error } = await supabase.from('drafts').delete().eq('id', draft.id)
    if (error) {
      toast.error(error.message)
      return
    }
    await logAction(user!.id, 'deleted', 'draft', draft.id, { name: draft.name })
    toast.success('Draft deleted!')
    fetchData()
  }

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString('en-CA', {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit'
    })
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

  return (
    <div style={{ padding: 32, fontFamily: 'DM Sans, sans-serif' }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1A1A2E', marginBottom: 4 }}>
        Drafts
      </h1>
      <p style={{ fontSize: 14, color: '#6B6B80', marginBottom: 24 }}>
        Create sandbox schedules to test before publishing live
      </p>

      {/* Info banner */}
      <div style={{
        background: '#EEEDFE', borderRadius: 12, padding: 16,
        marginBottom: 24, border: '1px solid rgba(83,74,183,0.2)',
        display: 'flex', alignItems: 'flex-start', gap: 12
      }}>
        <span style={{ fontSize: 20 }}>🧪</span>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#534AB7', marginBottom: 4 }}>
            Sandbox Mode
          </div>
          <div style={{ fontSize: 13, color: '#534AB7' }}>
            Drafts are private sandboxes. Assignments inside a draft do not affect live scheduling
            until you publish the draft. Only admins can see draft assignments.
          </div>
        </div>
      </div>

      {/* Generate with AI */}
      <div style={{
        background: 'white', borderRadius: 12, padding: 24,
        border: '1.5px solid #534AB7', marginBottom: 24
      }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, color: '#1A1A2E', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
          ✨ Generate with AI
        </h2>
        <p style={{ fontSize: 13, color: '#6B6B80', marginBottom: 16 }}>
          Claude reviews every unassigned section for a term and proposes a full draft schedule
          with a plain-English reason for each pick. Nothing goes live until you review and publish.
        </p>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#1A1A2E', marginBottom: 6 }}>
              Term
            </label>
            <select
              value={aiTermId}
              onChange={e => setAiTermId(e.target.value)}
              style={inputStyle}
            >
              <option value="">Select term...</option>
              {terms.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
          <button
            onClick={handleGenerateAi}
            disabled={generating || !aiTermId}
            style={{
              padding: '10px 24px',
              background: (generating || !aiTermId) ? '#a09ad4' : 'linear-gradient(135deg, #6C5FD6, #534AB7)',
              color: 'white', border: 'none', borderRadius: 9,
              fontSize: 14, fontWeight: 600,
              cursor: (generating || !aiTermId) ? 'not-allowed' : 'pointer',
              fontFamily: 'DM Sans, sans-serif', whiteSpace: 'nowrap'
            }}
          >
            {generating ? 'Generating...' : 'Generate Schedule'}
          </button>
        </div>

        {aiResult && (
          <div style={{
            background: aiResult.acceptedCount > 0 ? '#EAF3DE' : '#FCEBEB',
            borderRadius: 10, padding: 16, marginTop: 16,
            border: `1px solid ${aiResult.acceptedCount > 0 ? 'rgba(15,110,86,0.25)' : 'rgba(163,45,45,0.25)'}`
          }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: aiResult.acceptedCount > 0 ? '#0F6E56' : '#A32D2D', marginBottom: 4 }}>
              {aiResult.acceptedCount > 0
                ? `${aiResult.acceptedCount} assignment(s) generated in "${aiResult.draftName}"`
                : 'No sections could be confidently assigned'}
            </div>
            {aiResult.rejected.length > 0 && (
              <>
                <div style={{ fontSize: 13, color: '#854F0B', fontWeight: 600, marginTop: 8, marginBottom: 4 }}>
                  {aiResult.rejected.length} section(s) need manual review:
                </div>
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {aiResult.rejected.map((r, i) => (
                    <li key={i} style={{ fontSize: 13, color: '#6B6B80', marginBottom: 2 }}>
                      <strong style={{ color: '#1A1A2E' }}>{r.sectionLabel}</strong> — {r.reason}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {aiResult.draftId && (
              <Link
                to={`/admin/drafts/${aiResult.draftId}`}
                style={{ display: 'inline-block', marginTop: 12, fontSize: 13, fontWeight: 600, color: '#534AB7', textDecoration: 'none' }}
              >
                View Draft →
              </Link>
            )}
          </div>
        )}
      </div>

      {/* Add draft form */}
      <div style={{
        background: 'white', borderRadius: 12, padding: 24,
        border: '1px solid rgba(0,0,0,0.06)', boxShadow: 'var(--shadow-card)', marginBottom: 24
      }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, color: '#1A1A2E', marginBottom: 16 }}>
          Create New Draft
        </h2>
        <form onSubmit={handleAdd}>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#1A1A2E', marginBottom: 6 }}>
                Draft Name
              </label>
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. Winter 2026 Draft v1"
                style={{ ...inputStyle, borderColor: errors.name ? '#A32D2D' : '#e5e7eb' }}
              />
              {errors.name && <p style={{ color: '#A32D2D', fontSize: 12, marginTop: 4 }}>{errors.name}</p>}
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
            {adding ? 'Creating...' : 'Create Draft'}
          </button>
        </form>
      </div>

      {/* Drafts list */}
      {loading ? (
        <p style={{ color: '#6B6B80' }}>Loading...</p>
      ) : drafts.length === 0 ? (
        <div style={{
          background: 'white', borderRadius: 12, padding: 40,
          border: '1px dashed #e5e7eb', textAlign: 'center', color: '#6B6B80'
        }}>
          No drafts yet. Create one above to get started.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {drafts.map(draft => (
            <div key={draft.id} style={{
              background: 'white', borderRadius: 12, padding: 20,
              border: '1px solid rgba(0,0,0,0.06)', boxShadow: 'var(--shadow-card)',
              display: 'flex', alignItems: 'center', gap: 16
            }}>
              <div style={{
                width: 40, height: 40, borderRadius: 10,
                background: draft.status === 'published' ? '#EAF3DE' : '#EEEDFE',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 18, flexShrink: 0
              }}>
                {draft.status === 'published' ? '✅' : '🧪'}
              </div>

              <div style={{ flex: 1 }}>
                <Link
                  to={`/admin/drafts/${draft.id}`}
                  style={{ fontSize: 15, fontWeight: 600, color: '#1A1A2E', marginBottom: 4, textDecoration: 'none', display: 'block' }}
                >
                  {draft.name}
                </Link>
                <div style={{ fontSize: 13, color: '#6B6B80' }}>
                  {draft.term.name} • Created {formatDate(draft.created_at)}
                  {draft.published_at && ` • Published ${formatDate(draft.published_at)}`}
                </div>
              </div>

              <span style={{
                padding: '4px 12px', borderRadius: 20,
                fontSize: 12, fontWeight: 600,
                background: draft.status === 'published' ? '#EAF3DE' : '#FAEEDA',
                color: draft.status === 'published' ? '#0F6E56' : '#854F0B',
                textTransform: 'capitalize'
              }}>
                {draft.status}
              </span>

              <div style={{ display: 'flex', gap: 8 }}>
                <Link
                  to={`/admin/drafts/${draft.id}`}
                  style={{
                    padding: '7px 16px',
                    background: '#EEEDFE', color: '#534AB7',
                    border: 'none', borderRadius: 7,
                    fontSize: 13, fontWeight: 500,
                    cursor: 'pointer', fontFamily: 'DM Sans, sans-serif',
                    textDecoration: 'none'
                  }}
                >
                  {draft.status === 'sandbox' ? 'Open & Assign' : 'View'}
                </Link>
                <button
                  onClick={() => handleDelete(draft)}
                  style={{
                    padding: '7px 16px',
                    background: '#FCEBEB', color: '#A32D2D',
                    border: 'none', borderRadius: 7,
                    fontSize: 13, fontWeight: 500,
                    cursor: 'pointer', fontFamily: 'DM Sans, sans-serif'
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}