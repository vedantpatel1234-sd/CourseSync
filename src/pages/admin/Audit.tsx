import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

interface AuditLog {
  id: string
  action: string
  entity: string
  entity_id: string
  details: Record<string, unknown>
  created_at: string
  profile: { full_name: string; email: string } | null
}

const ACTION_COLORS: Record<string, { color: string; bg: string }> = {
  created: { color: '#0F6E56', bg: '#EAF3DE' },
  deleted: { color: '#A32D2D', bg: '#FCEBEB' },
  assigned: { color: '#534AB7', bg: '#EEEDFE' },
  removed: { color: '#854F0B', bg: '#FAEEDA' },
  login: { color: '#6B6B80', bg: '#f3f4f6' },
  verified: { color: '#0F6E56', bg: '#EAF3DE' },
}

const FILTERS = ['All', 'Assignments', 'Courses', 'Sections', 'Instructors']

export default function AdminAudit() {
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('All')

  const fetchLogs = async () => {
    const { data } = await supabase
      .from('audit_logs')
      .select('*, profile:profiles(full_name, email)')
      .order('created_at', { ascending: false })
      .limit(100)

    if (data) setLogs(data as AuditLog[])
    setLoading(false)
  }

  useEffect(() => { fetchLogs() }, [])

  const filtered = logs.filter(log => {
    if (filter === 'All') return true
    return log.entity.toLowerCase() === filter.toLowerCase().slice(0, -1)
  })

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr)
    return d.toLocaleString('en-CA', {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit'
    })
  }

  const getActionColor = (action: string) => {
    const key = Object.keys(ACTION_COLORS).find(k => action.toLowerCase().includes(k))
    return key ? ACTION_COLORS[key] : { color: '#6B6B80', bg: '#f3f4f6' }
  }

  return (
    <div style={{ padding: 32, fontFamily: 'DM Sans, sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 32 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1A1A2E', marginBottom: 4 }}>
            Audit Log
          </h1>
          <p style={{ fontSize: 14, color: '#6B6B80' }}>
            Track all actions taken in CourseSync
          </p>
        </div>
        <button
          onClick={fetchLogs}
          style={{
            padding: '9px 20px',
            background: 'white',
            color: '#534AB7',
            border: '1.5px solid #534AB7',
            borderRadius: 9,
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer',
            fontFamily: 'DM Sans, sans-serif'
          }}
        >
          Refresh
        </button>
      </div>

      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {FILTERS.map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              padding: '7px 16px',
              borderRadius: 20,
              border: filter === f ? 'none' : '1px solid rgba(0,0,0,0.07)',
              background: filter === f ? 'linear-gradient(135deg, #6C5FD6, #534AB7)' : 'white',
              color: filter === f ? 'white' : '#6B6B80',
              fontSize: 13,
              fontWeight: 500,
              cursor: 'pointer',
              fontFamily: 'DM Sans, sans-serif'
            }}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Logs table */}
      <div style={{
        background: 'white',
        borderRadius: 12,
        border: '1px solid rgba(0,0,0,0.06)', boxShadow: 'var(--shadow-card)',
        overflow: 'hidden'
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid rgba(0,0,0,0.07)' }}>
              {['Action', 'User', 'Details', 'Time'].map(h => (
                <th key={h} style={{
                  padding: '12px 16px', textAlign: 'left',
                  fontSize: 12, fontWeight: 600, color: '#6B6B80',
                  textTransform: 'uppercase', letterSpacing: '0.5px'
                }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={4} style={{ padding: 24, textAlign: 'center', color: '#6B6B80' }}>
                  Loading...
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={4} style={{ padding: 24, textAlign: 'center', color: '#6B6B80' }}>
                  No logs found.
                </td>
              </tr>
            ) : filtered.map(log => {
              const actionColor = getActionColor(log.action)
              return (
                <tr key={log.id} style={{ borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
                  <td style={{ padding: '12px 16px' }}>
                    <span style={{
                      background: actionColor.bg,
                      color: actionColor.color,
                      padding: '3px 10px',
                      borderRadius: 20,
                      fontSize: 12,
                      fontWeight: 600,
                      textTransform: 'capitalize'
                    }}>
                      {log.action}
                    </span>
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    {log.profile ? (
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#1A1A2E' }}>
                          {log.profile.full_name}
                        </div>
                        <div style={{ fontSize: 12, color: '#6B6B80' }}>
                          {log.profile.email}
                        </div>
                      </div>
                    ) : (
                      <span style={{ fontSize: 13, color: '#6B6B80' }}>System</span>
                    )}
                  </td>
                  <td style={{ padding: '12px 16px', fontSize: 13, color: '#6B6B80' }}>
                    {log.entity} {log.details ? `— ${JSON.stringify(log.details)}` : ''}
                  </td>
                  <td style={{ padding: '12px 16px', fontSize: 13, color: '#6B6B80', whiteSpace: 'nowrap' }}>
                    {formatDate(log.created_at)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}