import { useEffect } from 'react'
import { getEnvironment } from '../lib/environment'

// On a staging deployment: a permanent strip across the top so nobody mistakes it for the real
// site, and a "do not index" tag so search engines ignore it. Renders nothing in production.
export default function EnvironmentBanner() {
  const staging = getEnvironment() === 'staging'

  useEffect(() => {
    if (!staging) return
    const meta = document.createElement('meta')
    meta.name = 'robots'
    meta.content = 'noindex, nofollow'
    document.head.appendChild(meta)
    return () => { meta.remove() }
  }, [staging])

  if (!staging) return null

  return (
    <div role="note" style={{
      position: 'sticky', top: 0, zIndex: 2000, background: '#1A1A2E', color: '#F4F3F0',
      textAlign: 'center', padding: '6px 12px', fontSize: 12, fontWeight: 600, letterSpacing: '0.5px',
      fontFamily: 'DM Sans, sans-serif'
    }}>
      STAGING ENVIRONMENT. Test data only; this is not the live site.
    </div>
  )
}
