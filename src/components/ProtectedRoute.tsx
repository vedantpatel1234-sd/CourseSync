import { Navigate } from 'react-router-dom'
import TermsModal from './TermsModal'
import AccountPaused from './AccountPaused'
import { useAuthStore } from '../stores/authStore'
import { pausedReason } from '../lib/billing'

export default function ProtectedRoute({ children, role }: { children: React.ReactNode, role: string }) {
  const { user, termsAccepted, standing, initializing, setTermsAccepted } = useAuthStore()

  if (initializing) {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        fontFamily: 'DM Sans, sans-serif', color: '#6B6B80'
      }}>
        Loading...
      </div>
    )
  }

  if (!user) return <Navigate to="/login" />
  if (user.role !== role) return <Navigate to="/login" />

  if (termsAccepted === false) {
    return <TermsModal onAccepted={() => setTermsAccepted(true)} />
  }

  const paused = pausedReason(standing)
  if (paused) return <AccountPaused reason={paused} />

  return <>{children}</>
}
