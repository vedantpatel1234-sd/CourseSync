import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AdminHelp from './Help'

describe('AdminHelp', () => {
  it('renders every guide section', () => {
    render(<AdminHelp />)
    expect(screen.getByText('Getting Started')).toBeInTheDocument()
    expect(screen.getByText('Managing Instructors')).toBeInTheDocument()
    expect(screen.getByText('Running the Matching Engine')).toBeInTheDocument()
    expect(screen.getByText('Understanding Analytics')).toBeInTheDocument()
  })

  it('keeps every FAQ answer collapsed by default', () => {
    render(<AdminHelp />)
    expect(screen.queryByText(/Go to the Courses page/)).not.toBeInTheDocument()
  })

  it('expands an FAQ answer on click and collapses it again on a second click', async () => {
    const user = userEvent.setup()
    render(<AdminHelp />)

    await user.click(screen.getByText('How do I add a new course?'))
    expect(screen.getByText(/Go to the Courses page/)).toBeInTheDocument()

    await user.click(screen.getByText('How do I add a new course?'))
    expect(screen.queryByText(/Go to the Courses page/)).not.toBeInTheDocument()
  })

  it('only shows one FAQ answer open at a time', async () => {
    const user = userEvent.setup()
    render(<AdminHelp />)

    await user.click(screen.getByText('How do I add a new course?'))
    expect(screen.getByText(/Go to the Courses page/)).toBeInTheDocument()

    await user.click(screen.getByText('What does the Matching Engine do?'))
    expect(screen.queryByText(/Go to the Courses page/)).not.toBeInTheDocument()
    expect(screen.getByText(/weighted scoring algorithm/)).toBeInTheDocument()
  })

  it('links to support via mailto', () => {
    render(<AdminHelp />)
    const link = screen.getByRole('link', { name: 'Contact Support' })
    expect(link).toHaveAttribute('href', 'mailto:support@coursesync.ca')
  })
})
