import { useEffect, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, ClipboardList, Zap, Users, CalendarDays,
  BookOpen, BarChart2, Sparkles, FlaskConical, FileInput,
  ScrollText, HelpCircle, Star, Bell, LogOut, Newspaper
} from 'lucide-react'
import { useAuthStore } from '../../stores/authStore'
import { supabase } from '../../lib/supabase'

const adminNav = [
  { label: 'Dashboard', to: '/admin', icon: <LayoutDashboard size={17} /> },
  { label: 'Assignments', to: '/admin/assignments', icon: <ClipboardList size={17} /> },
  { label: 'Matching Engine', to: '/admin/matching', icon: <Zap size={17} /> },
  { label: 'Instructors', to: '/admin/instructors', icon: <Users size={17} /> },
  { label: 'Sections', to: '/admin/sections', icon: <CalendarDays size={17} /> },
  { label: 'Courses', to: '/admin/courses', icon: <BookOpen size={17} /> },
  { label: 'Analytics', to: '/admin/analytics', icon: <BarChart2 size={17} /> },
  { label: 'Scheduling Copilot', to: '/admin/ai', icon: <Sparkles size={17} /> },
  { label: 'Drafts', to: '/admin/drafts', icon: <FlaskConical size={17} /> },
  { label: 'Import', to: '/admin/import', icon: <FileInput size={17} /> },
  { label: 'Weekly Digest', to: '/admin/digest', icon: <Newspaper size={17} /> },
  { label: 'Audit Log', to: '/admin/audit', icon: <ScrollText size={17} /> },
  { label: 'Help', to: '/admin/help', icon: <HelpCircle size={17} /> },
]

const instructorNav = [
  { label: 'My Assignments', to: '/instructor', icon: <LayoutDashboard size={17} /> },
  { label: 'Qualifications', to: '/instructor/qualifications', icon: <Star size={17} /> },
  { label: 'Preferences', to: '/instructor/preferences', icon: <ClipboardList size={17} /> },
  { label: 'Availability', to: '/instructor/availability', icon: <CalendarDays size={17} /> },
  { label: 'Notifications', to: '/instructor/notifications', icon: <Bell size={17} /> },
  { label: 'Help', to: '/instructor/help', icon: <HelpCircle size={17} /> },
]

const coordinatorNav = [
  { label: 'Dashboard', to: '/coordinator', icon: <LayoutDashboard size={17} /> },
  { label: 'Assignments', to: '/coordinator/assignments', icon: <ClipboardList size={17} /> },
  { label: 'Instructors', to: '/coordinator/instructors', icon: <Users size={17} /> },
  { label: 'Analytics', to: '/coordinator/analytics', icon: <BarChart2 size={17} /> },
  { label: 'Help', to: '/coordinator/help', icon: <HelpCircle size={17} /> },
]

export default function Sidebar() {
  const { user, signOut } = useAuthStore()
  const navigate = useNavigate()
  const [unreadCount, setUnreadCount] = useState(0)

  useEffect(() => {
    if (!user || user.role !== 'instructor') return
    const fetchUnread = async () => {
      const { count } = await supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('read', false)
      setUnreadCount(count || 0)
    }
    fetchUnread()
  }, [user])

  if (!user) return null

  const navItems =
    user.role === 'admin' ? adminNav :
    user.role === 'instructor' ? instructorNav :
    coordinatorNav

  const handleSignOut = async () => {
    await signOut()
    navigate('/login')
  }

  const getInitials = (name: string) =>
    name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)

  return (
    <div style={{
      width: 208,
      minHeight: '100vh',
      background: 'white',
      borderRight: '1px solid rgba(0,0,0,0.07)',
      display: 'flex',
      flexDirection: 'column',
      flexShrink: 0,
      fontFamily: 'DM Sans, sans-serif'
    }}>
      {/* Logo */}
      <div style={{ padding: '20px 16px', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10,
            background: '#534AB7', display: 'flex',
            alignItems: 'center', justifyContent: 'center'
          }}>
            <span style={{ fontSize: 18 }}>🎓</span>
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#1A1A2E' }}>CourseSync</div>
            <div style={{ fontSize: 10, color: '#6B6B80' }}>Assignment management</div>
          </div>
        </div>
      </div>

      {/* Nav links */}
      <nav style={{ flex: 1, padding: '8px 8px', overflowY: 'auto' }}>
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/admin' || item.to === '/instructor' || item.to === '/coordinator'}
            style={({ isActive }) => ({
              display: 'flex',
              alignItems: 'center',
              gap: 9,
              padding: '8px 10px',
              borderRadius: 8,
              marginBottom: 2,
              textDecoration: 'none',
              fontSize: 13.5,
              fontWeight: isActive ? 600 : 400,
              color: isActive ? '#534AB7' : '#6B6B80',
              background: isActive ? '#EEEDFE' : 'transparent',
            })}
          >
            {item.icon}
            <span style={{ flex: 1 }}>{item.label}</span>
            {item.to === '/instructor/notifications' && unreadCount > 0 && (
              <span style={{
                minWidth: 18, height: 18, padding: '0 5px', borderRadius: 9,
                background: '#A32D2D', color: 'white',
                fontSize: 10.5, fontWeight: 700,
                display: 'flex', alignItems: 'center', justifyContent: 'center'
              }}>
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      {/* User footer */}
      <div style={{ borderTop: '1px solid rgba(0,0,0,0.06)', padding: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <div style={{
            width: 32, height: 32, borderRadius: '50%',
            background: '#534AB7', color: 'white',
            display: 'flex', alignItems: 'center',
            justifyContent: 'center', fontSize: 12, fontWeight: 600
          }}>
            {getInitials(user.full_name)}
          </div>
          <div style={{ overflow: 'hidden' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#1A1A2E', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {user.full_name}
            </div>
            <div style={{ fontSize: 11, color: '#6B6B80', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {user.email}
            </div>
          </div>
        </div>
        <button
          onClick={handleSignOut}
          style={{
            width: '100%', display: 'flex', alignItems: 'center',
            gap: 8, padding: '7px 10px', borderRadius: 8,
            border: 'none', background: 'transparent',
            color: '#6B6B80', fontSize: 13, cursor: 'pointer',
            fontFamily: 'DM Sans, sans-serif'
          }}
        >
          <LogOut size={15} />
          Sign out
        </button>
      </div>
    </div>
  )
}