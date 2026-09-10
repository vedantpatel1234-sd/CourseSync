import { useEffect, useState } from 'react'

interface SessionWarningModalProps {
  secondsLeft: number
  onStayLoggedIn: () => void
  onLogout: () => void
}

export default function SessionWarningModal({ secondsLeft, onStayLoggedIn, onLogout }: SessionWarningModalProps) {
  const [countdown, setCountdown] = useState(secondsLeft)

  useEffect(() => {
    setCountdown(secondsLeft)
  }, [secondsLeft])

  useEffect(() => {
    if (countdown <= 0) {
      onLogout()
      return
    }
    const timer = setTimeout(() => setCountdown(c => c - 1), 1000)
    return () => clearTimeout(timer)
  }, [countdown, onLogout])

  const minutes = Math.floor(countdown / 60)
  const seconds = countdown % 60

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 2000, padding: 20, fontFamily: 'DM Sans, sans-serif'
    }}>
      <div style={{
        background: 'white', borderRadius: 16, padding: 36,
        maxWidth: 420, width: '100%',
        boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
        textAlign: 'center'
      }}>
        <div style={{
          width: 56, height: 56, borderRadius: '50%',
          background: '#FAEEDA', display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 20px', fontSize: 28
        }}>
          ⏰
        </div>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: '#1A1A2E', marginBottom: 8 }}>
          Are you still there?
        </h2>
        <p style={{ fontSize: 14, color: '#6B6B80', marginBottom: 8, lineHeight: 1.6 }}>
          You have been inactive for a while. For your security, you will be signed out in:
        </p>
        <div style={{
          fontSize: 36, fontWeight: 700, color: '#854F0B',
          marginBottom: 24, fontVariantNumeric: 'tabular-nums'
        }}>
          {minutes}:{seconds.toString().padStart(2, '0')}
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <button
            onClick={onLogout}
            style={{
              flex: 1, padding: '11px 0',
              background: 'white', color: '#6B6B80',
              border: '1.5px solid #e5e7eb', borderRadius: 10,
              fontSize: 14, fontWeight: 600, cursor: 'pointer',
              fontFamily: 'DM Sans, sans-serif'
            }}
          >
            Sign out
          </button>
          <button
            onClick={onStayLoggedIn}
            style={{
              flex: 1, padding: '11px 0',
              background: '#534AB7', color: 'white',
              border: 'none', borderRadius: 10,
              fontSize: 14, fontWeight: 600, cursor: 'pointer',
              fontFamily: 'DM Sans, sans-serif'
            }}
          >
            Stay signed in
          </button>
        </div>
      </div>
    </div>
  )
}