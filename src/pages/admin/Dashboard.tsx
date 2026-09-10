import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

interface Stats {
  total: number
  filled: number
  partial: number
  unassigned: number
}

export default function AdminDashboard() {
  const [stats, setStats] = useState<Stats>({ total: 0, filled: 0, partial: 0, unassigned: 0 })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchStats = async () => {
      const { data } = await supabase
        .from('sections')
        .select('status')

      if (data) {
        setStats({
          total: data.length,
          filled: data.filter(s => s.status === 'filled').length,
          partial: data.filter(s => s.status === 'partial').length,
          unassigned: data.filter(s => s.status === 'unassigned').length,
        })
      }
      setLoading(false)
    }
    fetchStats()
  }, [])

  const cards = [
    { label: 'Total Sections', value: stats.total, color: '#534AB7', bg: '#EEEDFE' },
    { label: 'Filled', value: stats.filled, color: '#0F6E56', bg: '#EAF3DE' },
    { label: 'Partial', value: stats.partial, color: '#854F0B', bg: '#FAEEDA' },
    { label: 'Unassigned', value: stats.unassigned, color: '#A32D2D', bg: '#FCEBEB' },
  ]

  return (
    <div style={{ padding: 32, fontFamily: 'DM Sans, sans-serif' }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1A1A2E', marginBottom: 4 }}>
        Dashboard
      </h1>
      <p style={{ fontSize: 14, color: '#6B6B80', marginBottom: 32 }}>
        Winter 2026 overview
      </p>

      {loading ? (
        <p style={{ color: '#6B6B80' }}>Loading...</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
          {cards.map((card) => (
            <div
              key={card.label}
              style={{
                background: 'white',
                borderRadius: 12,
                padding: 20,
                border: '1px solid rgba(0,0,0,0.07)',
              }}
            >
              <div style={{
                display: 'inline-block',
                padding: '4px 10px',
                borderRadius: 20,
                background: card.bg,
                color: card.color,
                fontSize: 12,
                fontWeight: 600,
                marginBottom: 12
              }}>
                {card.label}
              </div>
              <div style={{ fontSize: 36, fontWeight: 700, color: card.color }}>
                {card.value}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}