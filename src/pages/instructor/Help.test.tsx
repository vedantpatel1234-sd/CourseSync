import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import InstructorHelp from './Help'

describe('InstructorHelp', () => {
  it('keeps FAQ answers collapsed by default and expands one on click', async () => {
    const user = userEvent.setup()
    render(<InstructorHelp />)

    expect(screen.queryByText(/drag sections from the Available list/)).not.toBeInTheDocument()

    await user.click(screen.getByText('How does ranking preferences work?'))
    expect(screen.getByText(/drag sections from the Available list/)).toBeInTheDocument()
  })

  it('links to support via mailto', () => {
    render(<InstructorHelp />)
    expect(screen.getByRole('link', { name: 'Contact Support' })).toHaveAttribute('href', 'mailto:support@coursesync.ca')
  })
})
