import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../stores/authStore'
import { logAction } from '../../lib/audit'
import { functionErrorMessage } from '../../lib/functionError'
import { validateStaffInvite, MAX_STAFF_ACCOUNTS, type StaffRole } from '../../../supabase/functions/_shared/staff'

interface StaffMember {
  id: string
  full_name: string
  email: string
  role: StaffRole
  created_at: string | null
}

interface ManageStaffResponse {
  id?: string
  success?: boolean
  error?: string
}

const ROLE_LABELS: Record<StaffRole, string> = { admin: 'Administrator', coordinator: 'Coordinator' }

const ROLE_DESCRIPTIONS: Record<StaffRole, string> = {
  admin: 'Full control: courses, sections, terms, instructors, assignments, AI features, billing and who has access.',
  coordinator: 'Read-only: can view the dashboard, assignments, instructor workloads and analytics, but cannot change anything.'
}

const ROLE_COLORS: Record<StaffRole, { color: string; bg: string }> = {
  admin: { color: '#534AB7', bg: '#EEEDFE' },
  coordinator: { color: '#0F6E56', bg: '#EAF3DE' }
}

const card = {
  background: 'white', borderRadius: 14, padding: 24, marginBottom: 24,
  border: '1px solid rgba(0,0,0,0.06)', boxShadow: 'var(--shadow-card)'
} as const

const inputStyle = {
  width: '100%', padding: '10px 14px', borderRadius: 9, border: '1.5px solid #e5e7eb',
  fontSize: 14, fontFamily: 'DM Sans, sans-serif', outline: 'none', color: '#1A1A2E', background: 'white'
} as const

const labelStyle = { display: 'block', fontSize: 13, fontWeight: 500, color: '#1A1A2E', marginBottom: 6 } as const

export default function AdminTeam() {
  const { user } = useAuthStore()
  const [members, setMembers] = useState<StaffMember[]>([])
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)
  const reload = () => setReloadKey(k => k + 1)

  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<StaffRole>('coordinator')
  const [error, setError] = useState('')
  const [inviting, setInviting] = useState(false)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [removingId, setRemovingId] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    const load = async () => {
      const { data } = await supabase
        .from('profiles')
        .select('id, full_name, email, role, created_at')
        .in('role', ['admin', 'coordinator'])
        .order('full_name')
      if (!active) return
      if (data) setMembers(data as StaffMember[])
      setLoading(false)
    }
    load()
    return () => { active = false }
  }, [reloadKey])

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault()
    // Same rules the server applies, so the message is the same either way.
    const checked = validateStaffInvite({ full_name: fullName, email, role })
    if (!checked.ok) {
      setError(checked.error)
      return
    }
    setError('')
    setInviting(true)

    const { data, error: invokeError } = await supabase.functions.invoke<ManageStaffResponse>('manage-staff', {
      body: {
        action: 'invite',
        ...checked.invite,
        redirect_to: `${window.location.origin}/set-password`
      }
    })

    if (invokeError || data?.error) {
      setError(await functionErrorMessage(invokeError, data))
      setInviting(false)
      return
    }

    // No name or email in the record: erasing a person also scrubs them from activity records.
    await logAction(user!.id, 'invited', 'staff', data!.id, { role: checked.invite.role })
    toast.success(`Invitation sent to ${checked.invite.email}`)
    setFullName('')
    setEmail('')
    setRole('coordinator')
    setInviting(false)
    reload()
  }

  const handleRemove = async (member: StaffMember) => {
    setRemovingId(member.id)
    const { data, error: invokeError } = await supabase.functions.invoke<ManageStaffResponse>('manage-staff', {
      body: { action: 'remove', user_id: member.id }
    })
    setRemovingId(null)

    if (invokeError || data?.error) {
      toast.error(await functionErrorMessage(invokeError, data))
      return
    }

    await logAction(user!.id, 'removed', 'staff', member.id, { role: member.role })
    toast.success('Account removed')
    setConfirmingId(null)
    reload()
  }

  return (
    <div style={{ padding: 32, fontFamily: 'DM Sans, sans-serif', maxWidth: 860 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1A1A2E', marginBottom: 4 }}>Team & access</h1>
      <p style={{ fontSize: 14, color: '#6B6B80', marginBottom: 28 }}>
        Choose who can sign in as an administrator or coordinator. Instructors are managed on the Instructors page.
      </p>

      <div style={card}>
        <h2 style={{ fontSize: 16, fontWeight: 600, color: '#1A1A2E', marginBottom: 16 }}>Invite someone</h2>
        <form onSubmit={handleInvite} noValidate>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginBottom: 16 }}>
            <div>
              <label htmlFor="team-name" style={labelStyle}>Full name</label>
              <input id="team-name" value={fullName} onChange={e => setFullName(e.target.value)}
                placeholder="Dana Lee" style={inputStyle} />
            </div>
            <div>
              <label htmlFor="team-email" style={labelStyle}>Email address</label>
              <input id="team-email" type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="dana@college.ca" style={inputStyle} />
            </div>
            <div>
              <label htmlFor="team-role" style={labelStyle}>Role</label>
              <select id="team-role" value={role} onChange={e => setRole(e.target.value as StaffRole)} style={inputStyle}>
                <option value="coordinator">Coordinator</option>
                <option value="admin">Administrator</option>
              </select>
            </div>
          </div>

          <p style={{ fontSize: 13, color: '#6B6B80', marginBottom: 16, lineHeight: 1.5 }}>
            <strong>{ROLE_LABELS[role]}.</strong> {ROLE_DESCRIPTIONS[role]}
          </p>

          {error && <p role="alert" style={{ color: '#A32D2D', fontSize: 13, marginBottom: 12 }}>{error}</p>}

          <button type="submit" disabled={inviting} style={{
            padding: '10px 22px', borderRadius: 9, border: 'none', color: 'white', fontSize: 14, fontWeight: 600,
            background: inviting ? '#a09ad4' : 'linear-gradient(135deg, #6C5FD6, #534AB7)',
            cursor: inviting ? 'not-allowed' : 'pointer', fontFamily: 'DM Sans, sans-serif'
          }}>
            {inviting ? 'Sending...' : 'Send invitation'}
          </button>
          <p style={{ fontSize: 12, color: '#6B6B80', marginTop: 12, lineHeight: 1.5 }}>
            They get an email with a link to choose their own password. If the link expires before they use it,
            they can use "Forgot password?" on the sign-in page. Up to {MAX_STAFF_ACCOUNTS} administrator and coordinator accounts.
          </p>
        </form>
      </div>

      <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '18px 24px', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, color: '#1A1A2E' }}>Administrators and coordinators</h2>
        </div>

        {loading ? (
          <p style={{ padding: 24, color: '#6B6B80', fontSize: 14 }}>Loading...</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Name', 'Email', 'Role', ''].map(h => (
                  <th key={h} style={{
                    padding: '10px 24px', textAlign: 'left', fontSize: 12, fontWeight: 600,
                    color: '#6B6B80', textTransform: 'uppercase', letterSpacing: '0.5px'
                  }}>{h || <span className="sr-only">Actions</span>}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {members.map(member => {
                const isYou = member.id === user?.id
                return (
                  <tr key={member.id} style={{ borderTop: '1px solid rgba(0,0,0,0.05)' }}>
                    <td style={{ padding: '14px 24px', fontSize: 14, color: '#1A1A2E', fontWeight: 500 }}>
                      {member.full_name}
                      {isYou && <span style={{ marginLeft: 8, fontSize: 11, color: '#6B6B80', fontWeight: 400 }}>(you)</span>}
                    </td>
                    <td style={{ padding: '14px 24px', fontSize: 14, color: '#6B6B80' }}>{member.email}</td>
                    <td style={{ padding: '14px 24px' }}>
                      <span style={{
                        padding: '3px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600, ...ROLE_COLORS[member.role]
                      }}>{ROLE_LABELS[member.role]}</span>
                    </td>
                    <td style={{ padding: '14px 24px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {isYou ? null : confirmingId === member.id ? (
                        <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
                          <span style={{ fontSize: 12, color: '#A32D2D' }}>Remove {member.full_name}?</span>
                          <button onClick={() => handleRemove(member)} disabled={removingId === member.id}
                            style={{ padding: '5px 12px', borderRadius: 8, border: 'none', background: '#A32D2D', color: 'white', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                            {removingId === member.id ? 'Removing...' : 'Confirm remove'}
                          </button>
                          <button onClick={() => setConfirmingId(null)}
                            style={{ padding: '5px 12px', borderRadius: 8, border: '1px solid #e5e7eb', background: 'white', color: '#6B6B80', fontSize: 12, cursor: 'pointer' }}>
                            Cancel
                          </button>
                        </span>
                      ) : (
                        <button onClick={() => setConfirmingId(member.id)}
                          style={{ padding: '5px 12px', borderRadius: 8, border: '1px solid rgba(163,45,45,0.3)', background: 'white', color: '#A32D2D', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>
                          Remove
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      <p style={{ fontSize: 12, color: '#6B6B80', lineHeight: 1.6 }}>
        Removing an account deletes that person's access and personal records. Drafts they created are handed to you.
        You can't remove your own account, and the last administrator can't be removed.
      </p>
    </div>
  )
}
