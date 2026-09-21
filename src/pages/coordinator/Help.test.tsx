import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CoordinatorHelp from './Help'

describe('CoordinatorHelp', () => {
  it('keeps FAQ answers collapsed by default and expands one on click', async () => {
    const user = userEvent.setup()
    render(<CoordinatorHelp />)

    expect(screen.queryByText(/read-only access/)).not.toBeInTheDocument()

    await user.click(screen.getByText('What can I do as a coordinator?'))
    expect(screen.getByText(/read-only access/)).toBeInTheDocument()
  })

  it('links to support via mailto', () => {
    render(<CoordinatorHelp />)
    expect(screen.getByRole('link', { name: 'Contact Support' })).toHaveAttribute('href', 'mailto:support@coursesync.ca')
  })
})
