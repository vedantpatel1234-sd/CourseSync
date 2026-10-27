import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import BillingBanner from '../BillingBanner'

export default function AppLayout() {
  return (
    <div style={{ display: 'flex', height: '100vh', background: 'transparent', overflow: 'hidden' }}>
      <Sidebar />
      <main style={{ flex: 1, minWidth: 0, overflowY: 'auto', overflowX: 'hidden' }}>
        <BillingBanner />
        <Outlet />
      </main>
    </div>
  )
}