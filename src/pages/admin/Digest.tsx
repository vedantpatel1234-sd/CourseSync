import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../stores/authStore'
import { logAction } from '../../lib/audit'
import { generateWeeklyDigest, type DigestHighlight, type DigestStats } from '../../lib/weeklyDigest'
import toast from 'react-hot-toast'

interface DigestRow {
  id: string
  summary: string
  highlights: DigestHighlight[]
  stats: DigestStats
  created_at: string
}

const SEVERITY_STYLE: Record<DigestHighlight['severity'], { color: string; bg: string; label: string }> = {
  high: { color: '#A32D2D', bg: '#FCEBEB', label: 'High' },
  medium: { color: '#854F0B', bg: '#FAEEDA', label: 'Medium' },
  low: { color: '#0F6E56', bg: '#EAF3DE', label: 'Low' }
}

export default function AdminDigest() {
  const { user } = useAuthStore()
  const [digests, setDigests] = useState<DigestRow[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)

  const fetchDigests = async () => {
    const { data } = await supabase
      .from('digests')
      .select('id, summary, highlights, stats, created_at')
      .order('created_at', { ascending: false })
      .limit(20)
    if (data) setDigests(data as unknown as DigestRow[])
    setLoading(false)
  }

  useEffect(() => { fetchDigests() }, [])

  const handleGenerate = async () => {
    if (!user) return
    setGenerating(true)
    try {
      const result = await generateWeeklyDigest()
      const { error } = await supabase.from('digests').insert({
        generated_by: user.id,
        summary: result.summary,
        highlights: result.highlights,
        stats: result.stats
      })
      if (error) {
        toast.error(error.message)
        return
      }
      await logAction(user.id, 'ai_generated', 'digest', undefined, {
        highlightCount: result.highlights.length,
        unfilledCount: result.stats.unfilledSections.length
      })
      toast.success('Digest generated!')
      fetchDigests()
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'Unknown error'
      toast.error(`Could not generate digest: ${detail}`)
    } finally {
      setGenerating(false)
    }
  }

  const formatDate = (dateStr: string) =>
    new Date(dateStr).toLocaleString('en-CA', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })

  return (
    <div style={{ padding: 32, fontFamily: 'DM Sans, sans-serif' }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1A1A2E', marginBottom: 4 }}>
        Weekly Digest
      </h1>
      <p style={{ fontSize: 14, color: '#6B6B80', marginBottom: 32 }}>
        AI-summarized scheduling health — workload imbalances, unfilled sections, and instructors near their hour cap
      </p>

      <div style={{
        background: 'white', borderRadius: 12, padding: 24,
        border: '1.5px solid #534AB7', marginBottom: 24
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 600, color: '#1A1A2E', marginBottom: 4 }}>
              ✨ Generate This Week's Digest
            </div>
            <div style={{ fontSize: 13, color: '#6B6B80' }}>
              Pulls real, current scheduling data and asks Claude to summarize and prioritize it — nothing here is invented.
            </div>
          </div>
          <button
            onClick={handleGenerate}
            disabled={generating}
            style={{
              padding: '10px 24px',
              background: generating ? '#a09ad4' : 'linear-gradient(135deg, #6C5FD6, #534AB7)',
              color: 'white', border: 'none', borderRadius: 9,
              fontSize: 14, fontWeight: 600,
              cursor: generating ? 'not-allowed' : 'pointer',
              fontFamily: 'DM Sans, sans-serif', whiteSpace: 'nowrap', flexShrink: 0
            }}
          >
            {generating ? 'Generating...' : 'Generate Digest'}
          </button>
        </div>
      </div>

      {loading ? (
        <p style={{ color: '#6B6B80' }}>Loading...</p>
      ) : digests.length === 0 ? (
        <div style={{
          background: 'white', borderRadius: 12, padding: 40,
          border: '1px dashed #e5e7eb', textAlign: 'center', color: '#6B6B80'
        }}>
          No digests yet. Generate one above to get started.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {digests.map(digest => (
            <div key={digest.id} style={{
              background: 'white', borderRadius: 12, padding: 24,
              border: '1px solid rgba(0,0,0,0.06)', boxShadow: 'var(--shadow-card)'
            }}>
              <div style={{ fontSize: 12, color: '#6B6B80', marginBottom: 8 }}>
                {formatDate(digest.created_at)}
              </div>
              <div style={{ fontSize: 14, color: '#1A1A2E', lineHeight: 1.6, marginBottom: digest.highlights.length > 0 ? 16 : 0 }}>
                {digest.summary}
              </div>

              {digest.highlights.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                  {digest.highlights.map((h, i) => {
                    const style = SEVERITY_STYLE[h.severity]
                    return (
                      <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                        <span style={{
                          flexShrink: 0, padding: '2px 9px', borderRadius: 20,
                          fontSize: 11, fontWeight: 700, color: style.color, background: style.bg
                        }}>
                          {style.label}
                        </span>
                        <span style={{ fontSize: 13, color: '#1A1A2E' }}>{h.text}</span>
                      </div>
                    )
                  })}
                </div>
              )}

              <div style={{ display: 'flex', gap: 16, fontSize: 12, color: '#6B6B80', borderTop: '1px solid rgba(0,0,0,0.06)', paddingTop: 12 }}>
                <span>{digest.stats.unfilledSections.length} unfilled section(s)</span>
                <span>{digest.stats.overloadedInstructors.length} instructor(s) near/over cap</span>
                <span>{digest.stats.underutilizedInstructors.length} instructor(s) underutilized</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
