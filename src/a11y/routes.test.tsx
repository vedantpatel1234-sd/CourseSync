import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import App from '../App'
import { useAuthStore } from '../stores/authStore'
import { accessibilityViolations } from '../test/axe'
import { titleForPath } from '../lib/pageTitles'

// Every route in the app, rendered through the real router, layout and auth store, then checked by
// axe. Data is empty (a new school's first day), which exercises each page's structure, forms and
// empty states; what a table looks like with rows is covered by the focused tests next to it.

vi.mock('../lib/supabase', () => {
  const none = { data: null, error: null }
  // A row in each of the tables whose pages edit records in place, so the "Edit" form is rendered too.
  const rows: Record<string, unknown[]> = {
    terms: [{ id: 't1', name: 'Fall 2026', start_date: '2026-09-01', end_date: '2026-12-15', is_active: true }],
    courses: [{ id: 'c1', code: 'CS101', name: 'Intro to Programming', department: 'Computer Science', description: 'Basics' }],
    sections: [{
      id: 's1', section_number: '001', hours_required: 3, status: 'unassigned', day_of_week: 'Monday', time_slot: '09:00-12:00',
      course: { code: 'CS101', name: 'Intro to Programming' }, term: { name: 'Fall 2026' }
    }]
  }
  function query(table: string): unknown {
    const result = { data: rows[table] ?? [], error: null, count: (rows[table] ?? []).length }
    return new Proxy({}, {
      get(_target, prop) {
        if (prop === 'then') return (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve)
        if (prop === 'single' || prop === 'maybeSingle') return () => Promise.resolve(none)
        return () => query(table)
      }
    })
  }
  return {
    supabase: {
      from: (table: string) => query(table),
      rpc: () => Promise.resolve(none),
      functions: { invoke: () => Promise.resolve(none) },
      auth: {
        getSession: () => Promise.resolve({ data: { session: null } }),
        signOut: () => Promise.resolve({ error: null }),
        signInWithPassword: () => Promise.resolve({ data: { user: null }, error: null }),
        resetPasswordForEmail: () => Promise.resolve({ error: null }),
        updateUser: () => Promise.resolve({ error: null })
      }
    }
  }
})

type Role = 'admin' | 'instructor' | 'coordinator'

const PUBLIC_ROUTES = ['/login', '/forgot-password', '/legal/terms', '/legal/privacy', '/legal/security']

const ROLE_ROUTES: Record<Role, string[]> = {
  admin: [
    '/admin', '/admin/courses', '/admin/sections', '/admin/terms', '/admin/instructors', '/admin/assignments',
    '/admin/calendar', '/admin/audit', '/admin/analytics', '/admin/ai', '/admin/matching', '/admin/drafts',
    '/admin/import', '/admin/digest', '/admin/team', '/admin/billing', '/admin/help'
  ],
  instructor: [
    '/instructor', '/instructor/qualifications', '/instructor/preferences', '/instructor/availability',
    '/instructor/notifications', '/instructor/help'
  ],
  coordinator: [
    '/coordinator', '/coordinator/assignments', '/coordinator/instructors', '/coordinator/analytics', '/coordinator/help'
  ]
}

function signInAs(role: Role | null) {
  useAuthStore.setState({
    initialize: async () => {},
    initializing: false,
    user: role ? { id: 'u1', full_name: 'Test Person', email: 'test@example.com', role } : null,
    termsAccepted: true,
    organizationName: 'Test College',
    standing: null,
    showWarning: false
  })
}

async function renderRoute(path: string) {
  cleanup()
  render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>)
  // The page must really have rendered: a crash or a redirect to the login page would otherwise
  // "pass" by having nothing in it to check.
  await screen.findAllByRole('heading')
  // Let the page's first round of data loading settle before inspecting it.
  await new Promise(r => setTimeout(r, 50))
  expect(screen.queryByText(/something went wrong/i)).toBeNull()
}

// Forms and dialogs hide behind buttons such as "Add course". Open every one that looks like that,
// so the second pass checks what a person sees after clicking, not only the page as first drawn.
const OPENERS = /^(\+\s*)?(add|new|create|invite|edit|generate|upload)\b/i

async function openEverything() {
  // Look the buttons up again after every click: opening one thing can re-render the page and
  // replace the buttons found earlier, and clicking a stale button does nothing.
  const clicked = new Set<string>()
  for (let i = 0; i < 12; i++) {
    const next = screen.queryAllByRole('button').find(button => {
      const name = (button.textContent ?? '').trim()
      // Never a form's own submit button: that would send the form instead of opening something.
      return OPENERS.test(name) && !button.hasAttribute('disabled') && !button.closest('form') && !clicked.has(name)
    })
    if (!next) break
    clicked.add((next.textContent ?? '').trim())
    await act(async () => { fireEvent.click(next) })
  }
  await new Promise(r => setTimeout(r, 50))
}

describe('accessibility: public pages', () => {
  beforeEach(() => signInAs(null))

  it.each(PUBLIC_ROUTES)('%s has no detectable violations', async path => {
    await renderRoute(path)
    expect(await accessibilityViolations()).toEqual([])
  })
})

describe.each(Object.entries(ROLE_ROUTES) as [Role, string[]][])('accessibility: %s pages', (role, routes) => {
  beforeEach(() => signInAs(role))

  it.each(routes)('%s has no detectable violations', async path => {
    await renderRoute(path)
    expect(screen.getByRole('main')).toBeInTheDocument()
    expect(await accessibilityViolations()).toEqual([])
  })

  it.each(routes)('%s has none once its forms and dialogs are open', async path => {
    await renderRoute(path)
    await openEverything()
    expect(await accessibilityViolations()).toEqual([])
  })
})

describe('page titles', () => {
  it.each(Object.values(ROLE_ROUTES).flat())('%s has a title of its own', path => {
    expect(titleForPath(path)).not.toBeNull()
  })

  it.each(['/login', '/forgot-password'])('%s sets the tab title when shown', async path => {
    signInAs(null)
    document.title = ''
    await renderRoute(path)
    expect(document.title).toMatch(/— CourseSync$/)
  })
})
