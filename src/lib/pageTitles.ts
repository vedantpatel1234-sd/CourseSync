import { useEffect } from 'react'

// In a single-page app the browser never loads a new page, so the tab title stays the same and a
// screen reader announces nothing when the user navigates. Giving every page its own title is what
// tells them where they are (WCAG 2.4.2), and it is also what makes browser history readable.

const SUFFIX = 'CourseSync'

const TITLES: Record<string, string> = {
  '/login': 'Sign in',
  '/forgot-password': 'Reset your password',
  '/set-password': 'Set your password',

  '/admin': 'Dashboard',
  '/admin/courses': 'Courses',
  '/admin/sections': 'Sections',
  '/admin/terms': 'Terms',
  '/admin/instructors': 'Instructors',
  '/admin/assignments': 'Assignments',
  '/admin/calendar': 'Calendar',
  '/admin/audit': 'Audit log',
  '/admin/analytics': 'Analytics',
  '/admin/ai': 'Scheduling Copilot',
  '/admin/matching': 'Matching engine',
  '/admin/drafts': 'Drafts',
  '/admin/import': 'Import',
  '/admin/digest': 'Weekly digest',
  '/admin/team': 'Team and access',
  '/admin/billing': 'Billing and usage',
  '/admin/help': 'Help',

  '/instructor': 'My assignments',
  '/instructor/qualifications': 'Qualifications',
  '/instructor/preferences': 'Preferences',
  '/instructor/availability': 'Availability',
  '/instructor/notifications': 'Notifications',
  '/instructor/help': 'Help',

  '/coordinator': 'Dashboard',
  '/coordinator/assignments': 'Assignments',
  '/coordinator/instructors': 'Instructors',
  '/coordinator/analytics': 'Analytics',
  '/coordinator/help': 'Help'
}

/** The title for a path, or null when it has none (an unknown path, or a page that sets its own). */
export function titleForPath(pathname: string): string | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
  if (TITLES[path]) return TITLES[path]
  if (/^\/admin\/drafts\/[^/]+$/.test(path)) return 'Draft'
  return null
}

export function formatTitle(title: string | null): string {
  return title ? `${title} — ${SUFFIX}` : SUFFIX
}

/** Sets the tab title for pages that are not part of the signed-in layout. */
export function usePageTitle(title: string): void {
  useEffect(() => {
    document.title = formatTitle(title)
  }, [title])
}

export const ROUTE_TITLES: Readonly<Record<string, string>> = TITLES
