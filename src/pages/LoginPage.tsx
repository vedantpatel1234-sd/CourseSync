import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import toast from 'react-hot-toast'
import { Eye, EyeOff } from 'lucide-react'

export default function LoginPage() {
  const navigate = useNavigate()
  const { signIn, loading, user } = useAuthStore()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')

  if (user) return <Navigate to={`/${user.role}`} replace />

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    const { error } = await signIn(email, password)
    if (error) {
      toast.error(error)
      setError(error)
      return
    }
    const user = useAuthStore.getState().user
    if (user?.role === 'admin') navigate('/admin')
    else if (user?.role === 'instructor') navigate('/instructor')
    else if (user?.role === 'coordinator') navigate('/coordinator')
  }

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: '#F4F3F0',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: 'DM Sans, sans-serif',
      padding: 20
    }}>
      <div style={{
        background: 'white',
        borderRadius: 20,
        padding: 40,
        width: '100%',
        maxWidth: 420,
        border: '1px solid rgba(0,0,0,0.06)',
        boxShadow: 'var(--shadow-pop)'
      }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1A1A2E', marginBottom: 6 }}>
          Welcome back
        </h1>
        <p style={{ fontSize: 14, color: '#6B6B80', marginBottom: 28 }}>
          Sign in to your CourseSync account
        </p>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#1A1A2E', marginBottom: 6 }}>
              Email address
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              style={{
                width: '100%',
                padding: '10px 14px',
                borderRadius: 9,
                border: '1.5px solid #e5e7eb',
                fontSize: 14,
                fontFamily: 'DM Sans, sans-serif',
                outline: 'none',
                color: '#1A1A2E'
              }}
            />
          </div>

          <div style={{ marginBottom: 24 }}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#1A1A2E', marginBottom: 6 }}>
              Password
            </label>
            <div style={{ position: 'relative' }}>
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                style={{
                  width: '100%',
                  padding: '10px 40px 10px 14px',
                  borderRadius: 9,
                  border: '1.5px solid #e5e7eb',
                  fontSize: 14,
                  fontFamily: 'DM Sans, sans-serif',
                  outline: 'none',
                  color: '#1A1A2E'
                }}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                style={{
                  position: 'absolute',
                  right: 12,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: '#6B6B80',
                  padding: 0,
                  display: 'flex',
                  alignItems: 'center'
                }}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            <div style={{ textAlign: 'right', marginTop: 8 }}>
              <Link to="/forgot-password" style={{ fontSize: 13, color: '#534AB7', fontWeight: 500 }}>
                Forgot password?
              </Link>
            </div>
          </div>

          {error && (
            <p style={{ color: '#A32D2D', fontSize: 13, marginBottom: 16 }}>
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%',
              padding: '12px 0',
              background: loading ? '#a09ad4' : 'linear-gradient(135deg, #6C5FD6, #534AB7)',
              color: 'white',
              border: 'none',
              borderRadius: 10,
              fontSize: 15,
              fontWeight: 600,
              cursor: loading ? 'not-allowed' : 'pointer',
              fontFamily: 'DM Sans, sans-serif'
            }}
          >
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>

        <nav aria-label="Legal" style={{ display: 'flex', justifyContent: 'center', gap: 16, marginTop: 24, paddingTop: 16, borderTop: '1px solid #f0f0f0' }}>
          <Link to="/legal/terms" style={{ fontSize: 12, color: '#6B6B80' }}>Terms</Link>
          <Link to="/legal/privacy" style={{ fontSize: 12, color: '#6B6B80' }}>Privacy</Link>
          <Link to="/legal/security" style={{ fontSize: 12, color: '#6B6B80' }}>Security</Link>
        </nav>
      </div>
    </div>
  )
}