import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../stores/authStore'
import { validatePassword } from '../lib/passwordRules'
import { usePageTitle } from '../lib/pageTitles'

// Landing page for invitation and password-reset email links (Supabase signs the
// visitor in from the link), and also used by signed-in users to change their
// password from the sidebar.
export default function SetPassword() {
  usePageTitle('Set your password')
  const navigate = useNavigate()
  const { user, initializing } = useAuthStore()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const shell = (children: React.ReactNode) => (
    <div role="main" style={{
      minHeight: '100vh', backgroundColor: '#F4F3F0', display: 'flex',
      alignItems: 'center', justifyContent: 'center',
      fontFamily: 'DM Sans, sans-serif', padding: 20
    }}>
      <div style={{
        background: 'white', borderRadius: 20, padding: 40, width: '100%', maxWidth: 420,
        border: '1px solid rgba(0,0,0,0.06)', boxShadow: 'var(--shadow-pop)'
      }}>
        {children}
      </div>
    </div>
  )

  if (initializing) {
    return shell(<p style={{ fontSize: 14, color: '#6B6B80' }}>Loading...</p>)
  }

  if (!user) {
    return shell(
      <>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1A1A2E', marginBottom: 6 }}>
          This link has expired
        </h1>
        <p style={{ fontSize: 14, color: '#6B6B80', marginBottom: 24 }}>
          Invitation and reset links can only be used once and expire after a while.
          Request a new one to continue.
        </p>
        <Link to="/forgot-password" style={{ fontSize: 14, color: '#534AB7', fontWeight: 500 }}>
          Send me a new link
        </Link>
      </>
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const problem = validatePassword(password)
    if (problem) {
      setError(problem)
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match')
      return
    }
    setError('')
    setSaving(true)
    const { error: updateError } = await supabase.auth.updateUser({ password })
    setSaving(false)
    if (updateError) {
      setError(updateError.message)
      return
    }
    toast.success('Password saved')
    navigate(`/${user.role}`, { replace: true })
  }

  const inputStyle = {
    width: '100%', padding: '10px 14px', borderRadius: 9,
    border: '1.5px solid #e5e7eb', fontSize: 14,
    fontFamily: 'DM Sans, sans-serif', outline: 'none', color: '#1A1A2E'
  }
  const labelStyle = { display: 'block', fontSize: 13, fontWeight: 500, color: '#1A1A2E', marginBottom: 6 }

  return shell(
    <>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1A1A2E', marginBottom: 6 }}>
        Choose a password
      </h1>
      <p style={{ fontSize: 14, color: '#6B6B80', marginBottom: 28 }}>
        Signed in as {user.email}. Use at least 8 characters, with an uppercase letter and a number.
      </p>
      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: 16 }}>
          <label htmlFor="setpassword-field-1" style={labelStyle}>New password</label>
          <input id="setpassword-field-1"
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Enter a new password"
            autoComplete="new-password"
            style={inputStyle}
          />
        </div>
        <div style={{ marginBottom: 20 }}>
          <label htmlFor="setpassword-field-2" style={labelStyle}>Confirm password</label>
          <input id="setpassword-field-2"
            type="password"
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            placeholder="Re-enter the password"
            autoComplete="new-password"
            style={inputStyle}
          />
        </div>
        {error && <p style={{ color: '#A32D2D', fontSize: 13, marginBottom: 16 }}>{error}</p>}
        <button
          type="submit"
          disabled={saving}
          style={{
            width: '100%', padding: '12px 0', borderRadius: 10, border: 'none',
            background: saving ? '#a09ad4' : 'linear-gradient(135deg, #6C5FD6, #534AB7)',
            color: 'white', fontSize: 14, fontWeight: 600,
            cursor: saving ? 'not-allowed' : 'pointer',
            fontFamily: 'DM Sans, sans-serif'
          }}
        >
          {saving ? 'Saving...' : 'Save password'}
        </button>
      </form>
    </>
  )
}
