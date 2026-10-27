import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import LegalPage from './LegalPage'
import { TERMS_VERSION } from '../legal'

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/legal/:doc" element={<LegalPage />} />
        <Route path="/login" element={<div>login page</div>} />
      </Routes>
    </MemoryRouter>
  )
}

describe('LegalPage', () => {
  it('renders the requested document without needing a sign-in', () => {
    renderAt('/legal/privacy')
    expect(screen.getByRole('heading', { level: 1, name: 'Privacy Policy' })).toBeInTheDocument()
  })

  it('renders markdown tables (the data inventory and the subprocessor list)', () => {
    renderAt('/legal/subprocessors')
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Provider' })).toBeInTheDocument()
    expect(screen.getByText('Anthropic, PBC')).toBeInTheDocument()
  })

  it('links between documents stay inside the app', () => {
    renderAt('/legal/terms')
    const link = screen.getAllByRole('link', { name: 'Privacy Policy' }).find(a => a.closest('article'))!
    expect(link).toHaveAttribute('href', '/legal/privacy')
    expect(link).not.toHaveAttribute('target')
  })

  it('offers navigation to every document and marks the current one', () => {
    renderAt('/legal/dpa')
    const nav = screen.getByRole('navigation', { name: 'Legal documents' })
    expect(nav.querySelectorAll('a')).toHaveLength(5)
    expect(screen.getByRole('link', { name: 'Data Processing Addendum' })).toHaveAttribute('aria-current', 'page')
  })

  it('says plainly that the document is a draft while it is one', () => {
    renderAt('/legal/terms')
    expect(screen.getByRole('note')).toHaveTextContent(/Draft, not yet in effect/)
  })

  it('shows the version users accept', () => {
    renderAt('/legal/terms')
    expect(screen.getByText(`Terms version ${TERMS_VERSION}`)).toBeInTheDocument()
  })

  it('shows a not-found message for an unknown document', () => {
    renderAt('/legal/nonsense')
    expect(screen.getByRole('heading', { name: 'Document not found' })).toBeInTheDocument()
  })
})
