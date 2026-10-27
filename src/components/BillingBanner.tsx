import { Link } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import { bannerFor } from '../lib/billing'

// A one-line notice for admins about a trial that is ending or an overdue invoice.
export default function BillingBanner() {
  const { user, standing } = useAuthStore()
  const banner = bannerFor(standing, user?.role)
  if (!banner) return null

  const warn = banner.tone === 'warn'
  return (
    <div role="status" style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
      padding: '10px 32px', fontFamily: 'DM Sans, sans-serif', fontSize: 13,
      background: warn ? '#FAEEDA' : '#EEEDFE', color: warn ? '#854F0B' : '#534AB7',
      borderBottom: `1px solid ${warn ? 'rgba(133,79,11,0.2)' : 'rgba(83,74,183,0.15)'}`
    }}>
      <span>{banner.text}</span>
      <Link to="/admin/billing" style={{ color: 'inherit', fontWeight: 600 }}>Billing & usage</Link>
    </div>
  )
}
