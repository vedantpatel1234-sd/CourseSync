import { useEffect, useRef } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import Sidebar from './Sidebar'
import BillingBanner from '../BillingBanner'
import { titleForPath, formatTitle } from '../../lib/pageTitles'

export default function AppLayout() {
  const { pathname } = useLocation()
  const mainRef = useRef<HTMLElement>(null)
  const firstRender = useRef(true)

  // On every navigation, name the page in the tab title and move keyboard focus to the content.
  // Without this a screen-reader user hears nothing after following a link, and a keyboard user is
  // left on the sidebar link they just used. The very first load is left alone: the browser has
  // already placed focus at the top of the document, which is where a skip link starts.
  useEffect(() => {
    document.title = formatTitle(titleForPath(pathname))
    if (firstRender.current) { firstRender.current = false; return }
    mainRef.current?.focus({ preventScroll: true })
  }, [pathname])

  return (
    <div style={{ display: 'flex', height: '100vh', background: 'transparent', overflow: 'hidden' }}>
      <a
        href="#main-content"
        className="skip-link"
        onClick={e => { e.preventDefault(); mainRef.current?.focus() }}
      >
        Skip to main content
      </a>
      <Sidebar />
      <main
        id="main-content"
        ref={mainRef}
        tabIndex={-1}
        style={{ flex: 1, minWidth: 0, overflowY: 'auto', overflowX: 'hidden', outline: 'none' }}
      >
        <BillingBanner />
        <Outlet />
      </main>
    </div>
  )
}
