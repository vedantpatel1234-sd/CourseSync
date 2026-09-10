import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../stores/authStore'
import toast from 'react-hot-toast'

interface NotifPrefs {
  notify_assigned: boolean
  notify_unassigned: boolean
  notify_qualification_verified: boolean
}

interface NotificationRow {
  id: string
  type: string
  message: string
  read: boolean
  created_at: string
}

export default function InstructorNotifications() {
  const { user } = useAuthStore()
  const [prefs, setPrefs] = useState<NotifPrefs>({
    notify_assigned: true,
    notify_unassigned: true,
    notify_qualification_verified: true
  })
  const [notifications, setNotifications] = useState<NotificationRow[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const fetchAll = async () => {
    if (!user) return
    const { data: prefsData } = await supabase
      .from('notification_preferences')
      .select('*')
      .eq('user_id', user.id)
      .single()

    const { data: notifData } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50)

    if (prefsData) setPrefs(prefsData)
    if (notifData) setNotifications(notifData as NotificationRow[])
    setLoading(false)
  }

  useEffect(() => { fetchAll() }, [user])

  const handleSave = async () => {
    if (!user) return
    setSaving(true)

    const { data: existing } = await supabase
      .from('notification_preferences')
      .select('id')
      .eq('user_id', user.id)
      .single()

    if (existing) {
      await supabase
        .from('notification_preferences')
        .update(prefs)
        .eq('user_id', user.id)
    } else {
      await supabase
        .from('notification_preferences')
        .insert({ user_id: user.id, ...prefs })
    }

    toast.success('Notification preferences saved!')
    setSaving(false)
  }

  const togglePref = (key: keyof NotifPrefs) => {
    setPrefs(prev => ({ ...prev, [key]: !prev[key] }))
  }

  const handleMarkAllRead = async () => {
    if (!user) return
    await supabase.from('notifications').update({ read: true }).eq('user_id', user.id).eq('read', false)
    setNotifications(prev => prev.map(n => ({ ...n, read: true })))
  }

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr)
    const diffMs = Date.now() - d.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    if (diffMins < 1) return 'just now'
    if (diffMins < 60) return `${diffMins}m ago`
    const diffHours = Math.floor(diffMins / 60)
    if (diffHours < 24) return `${diffHours}h ago`
    return d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })
  }

  const items = [
    { key: 'notify_assigned' as keyof NotifPrefs, label: 'Notify me when assigned to a section', desc: 'Get notified when an admin assigns you to a course section' },
    { key: 'notify_unassigned' as keyof NotifPrefs, label: 'Notify me when removed from a section', desc: 'Get notified when you are removed from a course section' },
    { key: 'notify_qualification_verified' as keyof NotifPrefs, label: 'Notify me when my qualification is verified', desc: 'Get notified when an admin verifies one of your qualifications' },
  ]

  const unreadCount = notifications.filter(n => !n.read).length

  if (loading) return <div style={{ padding: 32, fontFamily: 'DM Sans, sans-serif', color: '#6B6B80' }}>Loading...</div>

  return (
    <div style={{ padding: 32, fontFamily: 'DM Sans, sans-serif' }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1A1A2E', marginBottom: 4 }}>
        Notifications
      </h1>
      <p style={{ fontSize: 14, color: '#6B6B80', marginBottom: 32 }}>
        What's happened, and what you want to hear about
      </p>

      {/* Notification feed */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, color: '#1A1A2E' }}>
          Recent ({notifications.length})
        </h2>
        {unreadCount > 0 && (
          <button
            onClick={handleMarkAllRead}
            style={{
              padding: '6px 14px', background: '#EEEDFE', color: '#534AB7',
              border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 500,
              cursor: 'pointer', fontFamily: 'DM Sans, sans-serif'
            }}
          >
            Mark all as read
          </button>
        )}
      </div>

      <div style={{ background: 'white', borderRadius: 12, border: '1px solid rgba(0,0,0,0.06)', boxShadow: 'var(--shadow-card)', overflow: 'hidden', marginBottom: 32 }}>
        {notifications.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: '#6B6B80', fontSize: 14 }}>
            Nothing yet — you'll see activity here when you're assigned, removed, or verified.
          </div>
        ) : notifications.map((n, i) => (
          <div
            key={n.id}
            style={{
              display: 'flex', alignItems: 'flex-start', gap: 12,
              padding: '14px 20px',
              borderBottom: i < notifications.length - 1 ? '1px solid rgba(0,0,0,0.06)' : 'none',
              background: n.read ? 'white' : '#F9F8FF'
            }}
          >
            <div style={{
              width: 8, height: 8, borderRadius: '50%', marginTop: 6, flexShrink: 0,
              background: n.read ? 'transparent' : '#534AB7'
            }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13.5, color: '#1A1A2E' }}>{n.message}</div>
              <div style={{ fontSize: 12, color: '#6B6B80', marginTop: 2 }}>{formatDate(n.created_at)}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Preferences */}
      <h2 style={{ fontSize: 15, fontWeight: 600, color: '#1A1A2E', marginBottom: 12 }}>
        Preferences
      </h2>
      <div style={{ background: 'white', borderRadius: 12, border: '1px solid rgba(0,0,0,0.06)', boxShadow: 'var(--shadow-card)', overflow: 'hidden', marginBottom: 24 }}>
        {items.map((item, i) => (
          <div
            key={item.key}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '20px 24px',
              borderBottom: i < items.length - 1 ? '1px solid rgba(0,0,0,0.06)' : 'none'
            }}
          >
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#1A1A2E', marginBottom: 4 }}>
                {item.label}
              </div>
              <div style={{ fontSize: 13, color: '#6B6B80' }}>
                {item.desc}
              </div>
            </div>
            <button
              onClick={() => togglePref(item.key)}
              style={{
                width: 44,
                height: 24,
                borderRadius: 12,
                border: 'none',
                background: prefs[item.key] ? '#534AB7' : '#e5e7eb',
                cursor: 'pointer',
                position: 'relative',
                transition: 'background 0.2s',
                flexShrink: 0,
                marginLeft: 24
              }}
            >
              <div style={{
                width: 18,
                height: 18,
                borderRadius: '50%',
                background: 'white',
                position: 'absolute',
                top: 3,
                left: prefs[item.key] ? 23 : 3,
                transition: 'left 0.2s',
                boxShadow: '0 1px 3px rgba(0,0,0,0.2)'
              }} />
            </button>
          </div>
        ))}
      </div>

      <button
        onClick={handleSave}
        disabled={saving}
        style={{
          padding: '10px 24px',
          background: saving ? '#a09ad4' : 'linear-gradient(135deg, #6C5FD6, #534AB7)',
          color: 'white',
          border: 'none',
          borderRadius: 9,
          fontSize: 14,
          fontWeight: 600,
          cursor: saving ? 'not-allowed' : 'pointer',
          fontFamily: 'DM Sans, sans-serif'
        }}
      >
        {saving ? 'Saving...' : 'Save Preferences'}
      </button>
    </div>
  )
}
