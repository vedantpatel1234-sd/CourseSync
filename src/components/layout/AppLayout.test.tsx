import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route, Link } from 'react-router-dom'
import AppLayout from './AppLayout'
import { useAuthStore } from '../../stores/authStore'

vi.mock('../../lib/supabase', () => ({ supabase: { from: vi.fn(), rpc: vi.fn(), auth: { signOut: vi.fn() } } }))

function renderLayout(path = '/admin/courses') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/admin" element={<AppLayout />}>
          <Route path="courses" element={<div><h1>Courses page</h1><Link to="/admin/terms">Go to terms</Link></div>} />
          <Route path="terms" element={<h1>Terms page</h1>} />
        </Route>
      </Routes>
    </MemoryRouter>
  )
}

describe('AppLayout accessibility behaviour', () => {
  beforeEach(() => {
    document.title = 'CourseSync — Assignment Management'
    useAuthStore.setState({
      user: { id: 'u1', full_name: 'Jane Doe', email: 'jane@example.com', role: 'admin' },
      organizationName: 'Test College', standing: null
    })
  })

  it('offers a skip link that is the first thing a keyboard user reaches', async () => {
    const user = userEvent.setup()
    renderLayout()
    await user.tab()
    expect(screen.getByRole('link', { name: 'Skip to main content' })).toHaveFocus()
  })

  it('the skip link moves focus to the main content', async () => {
    const user = userEvent.setup()
    renderLayout()
    await user.click(screen.getByRole('link', { name: 'Skip to main content' }))
    expect(screen.getByRole('main')).toHaveFocus()
  })

  it('titles the tab after the page', () => {
    renderLayout('/admin/courses')
    expect(document.title).toBe('Courses — CourseSync')
  })

  it('does not steal focus on the first load', () => {
    renderLayout()
    expect(screen.getByRole('main')).not.toHaveFocus()
  })

  it('on navigation, updates the title and moves focus to the content', async () => {
    const user = userEvent.setup()
    renderLayout('/admin/courses')
    await user.click(screen.getByRole('link', { name: 'Go to terms' }))
    expect(await screen.findByRole('heading', { name: 'Terms page' })).toBeInTheDocument()
    expect(document.title).toBe('Terms — CourseSync')
    expect(screen.getByRole('main')).toHaveFocus()
  })

  it('names the navigation landmark', () => {
    renderLayout()
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument()
  })
})
