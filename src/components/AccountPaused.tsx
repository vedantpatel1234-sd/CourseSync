import { useAuthStore } from '../stores/authStore'
import { SUPPORT_EMAIL } from '../lib/billing'

// Shown instead of the app when the organization's trial has ended or its subscription is
// suspended or canceled. Signing out always works.
export default function AccountPaused({ reason }: { reason: string }) {
  const { user, organizationName, signOut } = useAuthStore()
  const isAdmin = user?.role === 'admin'

  return (
    <div style={{
      minHeight: '100vh', backgroundColor: '#F4F3F0', display: 'flex',
      alignItems: 'center', justifyContent: 'center',
      fontFamily: 'DM Sans, sans-serif', padding: 20
    }}>
      <div style={{
        background: 'white', borderRadius: 20, padding: 40, width: '100%', maxWidth: 460,
        border: '1px solid rgba(0,0,0,0.06)', boxShadow: 'var(--shadow-pop)'
      }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#1A1A2E', marginBottom: 8 }}>
          {organizationName ? `${organizationName} is paused` : 'Your account is paused'}
        </h1>
        <p style={{ fontSize: 14, color: '#6B6B80', lineHeight: 1.6, marginBottom: 16 }}>{reason}</p>
        <p style={{ fontSize: 14, color: '#6B6B80', lineHeight: 1.6, marginBottom: 24 }}>
          {isAdmin
            ? 'Your data is safe and nothing has been deleted. '
            : 'Please ask your department administrator to get in touch. '}
          {SUPPORT_EMAIL
            ? <>Contact <a href={`mailto:${SUPPORT_EMAIL}`} style={{ color: '#534AB7' }}>{SUPPORT_EMAIL}</a> to restore access.</>
            : 'Contact us to restore access.'}
        </p>
        <button
          onClick={() => signOut()}
          style={{
            width: '100%', padding: '12px 0', borderRadius: 10, border: '1.5px solid #534AB7',
            background: 'white', color: '#534AB7', fontSize: 14, fontWeight: 600,
            cursor: 'pointer', fontFamily: 'DM Sans, sans-serif'
          }}
        >
          Sign out
        </button>
      </div>
    </div>
  )
}
