import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../stores/authStore'
import toast from 'react-hot-toast'

interface TermsModalProps {
  onAccepted: () => void
}

export default function TermsModal({ onAccepted }: TermsModalProps) {
  const [checked, setChecked] = useState(false)
  const [loading, setLoading] = useState(false)
  const { user } = useAuthStore()

  const handleAccept = async () => {
    if (!checked || !user) return
    setLoading(true)
    const { error } = await supabase.from('terms_acceptance').insert({
      user_id: user.id,
      accepted_at: new Date().toISOString(),
      version: '1.0'
    })
    if (error) {
      toast.error('Failed to save acceptance. Please try again.')
      setLoading(false)
      return
    }
    toast.success('Welcome to CourseSync!')
    onAccepted()
    setLoading(false)
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 1000, padding: 20
    }}>
      <div style={{
        background: 'white', borderRadius: 16, padding: 36,
        maxWidth: 480, width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.15)',
        fontFamily: 'DM Sans, sans-serif'
      }}>
        <div style={{
          width: 48, height: 48, borderRadius: 12,
          background: '#EEEDFE', display: 'flex',
          alignItems: 'center', justifyContent: 'center', marginBottom: 20
        }}>
          <span style={{ fontSize: 24 }}>🎓</span>
        </div>
        <h2 style={{ fontSize: 22, fontWeight: 700, color: '#1A1A2E', marginBottom: 8 }}>
          Welcome to CourseSync
        </h2>
        <p style={{ fontSize: 14, color: '#6B6B80', marginBottom: 24, lineHeight: 1.6 }}>
          Before you continue, please review and accept our Terms of Service and Privacy Policy.
        </p>
        <div style={{
          background: '#F4F3F0', borderRadius: 10, padding: 16,
          marginBottom: 24, fontSize: 13, color: '#6B6B80', lineHeight: 1.6
        }}>
          By using CourseSync, you agree to use the platform for legitimate academic scheduling
          purposes, keep your credentials secure, and comply with your institution's policies.
        </div>
        <label style={{
          display: 'flex', alignItems: 'flex-start', gap: 10,
          cursor: 'pointer', marginBottom: 24
        }}>
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
            style={{ marginTop: 2, accentColor: '#534AB7', width: 16, height: 16 }}
          />
          <span style={{ fontSize: 14, color: '#1A1A2E', lineHeight: 1.5 }}>
            I agree to the Terms of Service and Privacy Policy
          </span>
        </label>
        <button
          onClick={handleAccept}
          disabled={!checked || loading}
          style={{
            width: '100%', padding: '12px 0',
            background: checked ? '#534AB7' : '#e5e7eb',
            color: checked ? 'white' : '#9ca3af',
            border: 'none', borderRadius: 10,
            fontSize: 15, fontWeight: 600,
            cursor: checked ? 'pointer' : 'not-allowed',
            fontFamily: 'DM Sans, sans-serif'
          }}
        >
          {loading ? 'Saving...' : 'Accept & Continue'}
        </button>
      </div>
    </div>
  )
}