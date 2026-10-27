import { Component, type ErrorInfo, type ReactNode } from 'react'
import { reportError } from '../lib/errorReporting'
import { SUPPORT_EMAIL } from '../lib/billing'

interface State {
  failed: boolean
}

// Catches an error thrown while rendering any page and shows a calm fallback instead of a blank
// white screen. The error is reported so it can be fixed.
export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    void reportError(error, 'boundary', `Component stack:${info.componentStack ?? ''}`)
  }

  render() {
    if (!this.state.failed) return this.props.children

    return (
      <div role="alert" style={{
        minHeight: '100vh', backgroundColor: '#F4F3F0', display: 'flex',
        alignItems: 'center', justifyContent: 'center', padding: 20, fontFamily: 'DM Sans, sans-serif'
      }}>
        <div style={{
          background: 'white', borderRadius: 20, padding: 40, maxWidth: 440, width: '100%',
          border: '1px solid rgba(0,0,0,0.06)', boxShadow: 'var(--shadow-pop)'
        }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#1A1A2E', marginBottom: 8 }}>Something went wrong</h1>
          <p style={{ fontSize: 14, color: '#6B6B80', lineHeight: 1.6, marginBottom: 24 }}>
            This page hit an unexpected problem. Reloading usually fixes it. Your data is safe.
            {SUPPORT_EMAIL
              ? <> If it keeps happening, contact <a href={`mailto:${SUPPORT_EMAIL}`} style={{ color: '#534AB7' }}>{SUPPORT_EMAIL}</a>.</>
              : ' If it keeps happening, please contact support.'}
          </p>
          <div style={{ display: 'flex', gap: 12 }}>
            <button onClick={() => window.location.reload()} style={{
              flex: 1, padding: '11px 0', borderRadius: 10, border: 'none', color: 'white', fontSize: 14, fontWeight: 600,
              background: 'linear-gradient(135deg, #6C5FD6, #534AB7)', cursor: 'pointer', fontFamily: 'DM Sans, sans-serif'
            }}>
              Reload page
            </button>
            <a href="/login" style={{
              flex: 1, textAlign: 'center', padding: '11px 0', borderRadius: 10, border: '1.5px solid #534AB7',
              color: '#534AB7', fontSize: 14, fontWeight: 600, textDecoration: 'none'
            }}>
              Back to sign in
            </a>
          </div>
        </div>
      </div>
    )
  }
}
