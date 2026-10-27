import { describe, it, expect, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import EnvironmentBanner from './EnvironmentBanner'

const robots = () => document.querySelector('meta[name="robots"]')

describe('EnvironmentBanner', () => {
  afterEach(() => {
    delete (import.meta.env as Record<string, unknown>).VITE_APP_ENV
  })

  it('shows nothing on the live site', () => {
    ;(import.meta.env as Record<string, unknown>).VITE_APP_ENV = 'production'
    const { container } = render(<EnvironmentBanner />)
    expect(container).toBeEmptyDOMElement()
    expect(robots()).toBeNull()
  })

  it('shows nothing during local development', () => {
    const { container } = render(<EnvironmentBanner />)
    expect(container).toBeEmptyDOMElement()
  })

  it('on staging, says so clearly and asks search engines not to index the site', () => {
    ;(import.meta.env as Record<string, unknown>).VITE_APP_ENV = 'staging'
    render(<EnvironmentBanner />)
    expect(screen.getByRole('note')).toHaveTextContent(/STAGING ENVIRONMENT/)
    expect(screen.getByRole('note')).toHaveTextContent(/not the live site/i)
    expect(robots()).toHaveAttribute('content', 'noindex, nofollow')
  })

  it('removes the do-not-index tag again when it goes away', () => {
    ;(import.meta.env as Record<string, unknown>).VITE_APP_ENV = 'staging'
    const { unmount } = render(<EnvironmentBanner />)
    expect(robots()).not.toBeNull()
    unmount()
    expect(robots()).toBeNull()
  })
})
