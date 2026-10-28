import { useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { usePageTitle } from '../lib/pageTitles'

export default function ForgotPassword() {
  usePageTitle('Reset your password')
  const [email, setEmail] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!/\S+@\S+\.\S+/.test(email)) {
      toast.error('Enter a valid email address')
      return
    }
    setSending(true)
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/set-password`
    })
    setSending(false)
    if (error) {
      toast.error(error.message)
      return
    }
    // Same message whether or not the address has an account, so this page
    // can't be used to find out who is registered.
    setSent(true)
  }

  return (
    <div role="main" style={{
      minHeight: '100vh', backgroundColor: '#F4F3F0', display: 'flex',
      alignItems: 'center', justifyContent: 'center',
      fontFamily: 'DM Sans, sans-serif', padding: 20
    }}>
      <div style={{
        background: 'white', borderRadius: 20, padding: 40, width: '100%', maxWidth: 420,
        border: '1px solid rgba(0,0,0,0.06)', boxShadow: 'var(--shadow-pop)'
      }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1A1A2E', marginBottom: 6 }}>
          Reset your password
        </h1>

        {sent ? (
          <>
            <p style={{ fontSize: 14, color: '#6B6B80', marginBottom: 24 }}>
              If an account exists for <strong>{email.trim()}</strong>, we've sent a link to set a new password.
              It can take a minute to arrive — check your spam folder too.
            </p>
            <Link to="/login" style={{ fontSize: 14, color: '#534AB7', fontWeight: 500 }}>
              Back to sign in
            </Link>
          </>
        ) : (
          <>
            <p style={{ fontSize: 14, color: '#6B6B80', marginBottom: 28 }}>
              Enter your email and we'll send you a link to choose a new password.
            </p>
            <form onSubmit={handleSubmit}>
              <label htmlFor="forgotpassword-field-1" style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#1A1A2E', marginBottom: 6 }}>
                Email address
              </label>
              <input id="forgotpassword-field-1"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                style={{
                  width: '100%', padding: '10px 14px', borderRadius: 9,
                  border: '1.5px solid #e5e7eb', fontSize: 14,
                  fontFamily: 'DM Sans, sans-serif', outline: 'none',
                  color: '#1A1A2E', marginBottom: 20
                }}
              />
              <button
                type="submit"
                disabled={sending}
                style={{
                  width: '100%', padding: '12px 0', borderRadius: 10, border: 'none',
                  background: sending ? '#a09ad4' : 'linear-gradient(135deg, #6C5FD6, #534AB7)',
                  color: 'white', fontSize: 14, fontWeight: 600,
                  cursor: sending ? 'not-allowed' : 'pointer',
                  fontFamily: 'DM Sans, sans-serif', marginBottom: 16
                }}
              >
                {sending ? 'Sending...' : 'Send reset link'}
              </button>
            </form>
            <Link to="/login" style={{ fontSize: 14, color: '#534AB7', fontWeight: 500 }}>
              Back to sign in
            </Link>
          </>
        )}
      </div>
    </div>
  )
}
