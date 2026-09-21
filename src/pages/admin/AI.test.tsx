import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type Anthropic from '@anthropic-ai/sdk'
import toast from 'react-hot-toast'
import AdminAI from './AI'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../stores/authStore'
import { logAction } from '../../lib/audit'
import { notifyInstructor } from '../../lib/notifications'
import { createMessage } from '../../lib/anthropic'
import {
  listSectionsTool, buildAssignmentPreview, buildDraftPreview
} from '../../lib/copilotTools'

vi.mock('../../lib/supabase', () => ({ supabase: { from: vi.fn() } }))
vi.mock('../../stores/authStore', () => ({ useAuthStore: vi.fn() }))
vi.mock('../../lib/audit', () => ({ logAction: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../../lib/notifications', () => ({ notifyInstructor: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../../lib/anthropic', () => ({ createMessage: vi.fn(), COPILOT_MODEL: 'claude-opus-5' }))
vi.mock('../../lib/copilotTools', () => ({
  COPILOT_TOOLS: [],
  listUnassignedSections: vi.fn(),
  findQualifiedInstructors: vi.fn(),
  getInstructorWorkload: vi.fn(),
  listSectionsTool: vi.fn(),
  listAssignmentsTool: vi.fn(),
  buildAssignmentPreview: vi.fn(),
  buildDraftPreview: vi.fn()
}))
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }))

const ADMIN_USER = { id: 'admin-1', full_name: 'Admin', email: 'admin@example.com', role: 'admin' as const }

function textResponse(text: string): Anthropic.Message {
  return { content: [{ type: 'text', text, citations: null }], stop_reason: 'end_turn' } as unknown as Anthropic.Message
}

function toolUseResponse(name: string, input: unknown, id = 'tool_1'): Anthropic.Message {
  return { content: [{ type: 'tool_use', id, name, input }], stop_reason: 'tool_use' } as unknown as Anthropic.Message
}

async function sendMessage(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.type(screen.getByPlaceholderText('Ask something about your schedule...'), text)
  await user.click(screen.getByRole('button', { name: /Send/ }))
}

describe('AdminAI', () => {
  beforeEach(() => {
    vi.mocked(useAuthStore).mockReturnValue({ user: ADMIN_USER } as never)
    vi.mocked(createMessage).mockReset()
    vi.mocked(supabase.from).mockReset()
    vi.mocked(toast.error).mockReset()
    vi.mocked(toast.success).mockReset()
    vi.mocked(logAction).mockClear()
    vi.mocked(notifyInstructor).mockClear()
    vi.mocked(listSectionsTool).mockReset()
    vi.mocked(buildAssignmentPreview).mockReset()
    vi.mocked(buildDraftPreview).mockReset()
  })

  it('shows the welcome message on load', () => {
    render(<AdminAI />)
    expect(screen.getByText(/I'm your Scheduling Copilot/)).toBeInTheDocument()
  })

  it('sends a message and displays a plain text reply', async () => {
    vi.mocked(createMessage).mockResolvedValue(textResponse('There are 3 unfilled sections.'))
    const user = userEvent.setup()
    render(<AdminAI />)

    await sendMessage(user, 'How many sections are unfilled?')

    expect(screen.getByText('How many sections are unfilled?')).toBeInTheDocument()
    expect(await screen.findByText('There are 3 unfilled sections.')).toBeInTheDocument()
    expect(createMessage).toHaveBeenCalledTimes(1)
  })

  it('executes a read-only tool call and continues the conversation automatically', async () => {
    vi.mocked(createMessage)
      .mockResolvedValueOnce(toolUseResponse('list_sections', { status: 'all' }))
      .mockResolvedValueOnce(textResponse('No sections found.'))
    vi.mocked(listSectionsTool).mockResolvedValue({ count: 0, sections: [] })
    const user = userEvent.setup()
    render(<AdminAI />)

    await sendMessage(user, 'list sections')

    expect(await screen.findByText('No sections found.')).toBeInTheDocument()
    expect(listSectionsTool).toHaveBeenCalledWith({ status: 'all' })
    expect(createMessage).toHaveBeenCalledTimes(2)
  })

  it('stages a clean assignment preview as a confirm/cancel action card instead of auto-executing', async () => {
    vi.mocked(createMessage).mockResolvedValue(toolUseResponse('propose_assignment', { section_id: 'sec-1', instructor_id: 'inst-1' }))
    vi.mocked(buildAssignmentPreview).mockResolvedValue({
      kind: 'assignment', sectionId: 'sec-1', instructorId: 'inst-1',
      sectionLabel: 'CS101 — Section 01', instructorName: 'Jane Doe',
      hours: 3, dayTime: 'Monday 9:00 AM', blocked: false, reasons: []
    })
    const user = userEvent.setup()
    render(<AdminAI />)

    await sendMessage(user, 'assign jane to cs101')

    expect(await screen.findByText('Jane Doe → CS101 — Section 01')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument()
    expect(supabase.from).not.toHaveBeenCalled()
    // Only one createMessage call — staging a pending action does not continue the loop on its own.
    expect(createMessage).toHaveBeenCalledTimes(1)
  })

  it('never shows a confirm card for a blocked proposal, and reports it back to the model instead', async () => {
    vi.mocked(createMessage)
      .mockResolvedValueOnce(toolUseResponse('propose_assignment', { section_id: 'sec-1', instructor_id: 'inst-1' }))
      .mockResolvedValueOnce(textResponse('Jane is already teaching another section then.'))
    vi.mocked(buildAssignmentPreview).mockResolvedValue({
      kind: 'assignment', sectionId: 'sec-1', instructorId: 'inst-1',
      sectionLabel: 'CS101 — Section 01', instructorName: 'Jane Doe',
      hours: 3, dayTime: 'Monday 9:00 AM', blocked: true, reasons: ['Blocked: double booked']
    })
    const user = userEvent.setup()
    render(<AdminAI />)

    await sendMessage(user, 'assign jane to cs101')

    expect(await screen.findByText('Jane is already teaching another section then.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument()
    expect(createMessage).toHaveBeenCalledTimes(2)
  })

  it('confirming an assignment inserts it, notifies the instructor, and marks the card confirmed', async () => {
    vi.mocked(createMessage)
      .mockResolvedValueOnce(toolUseResponse('propose_assignment', { section_id: 'sec-1', instructor_id: 'inst-1' }))
      .mockResolvedValueOnce(textResponse('Done!'))
    vi.mocked(buildAssignmentPreview).mockResolvedValue({
      kind: 'assignment', sectionId: 'sec-1', instructorId: 'inst-1',
      sectionLabel: 'CS101 — Section 01', instructorName: 'Jane Doe',
      hours: 3, dayTime: 'Monday 9:00 AM', blocked: false, reasons: []
    })
    vi.mocked(supabase.from).mockReturnValue({ insert: vi.fn().mockResolvedValue({ error: null }) } as never)
    const user = userEvent.setup()
    render(<AdminAI />)
    await sendMessage(user, 'assign jane to cs101')
    await screen.findByRole('button', { name: 'Confirm' })

    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Assignment created!'))
    expect(supabase.from).toHaveBeenCalledWith('assignments')
    expect(logAction).toHaveBeenCalledWith('admin-1', 'assigned', 'assignment', undefined, {
      instructor: 'Jane Doe', section: 'CS101 — Section 01', via: 'copilot'
    })
    expect(notifyInstructor).toHaveBeenCalledWith('inst-1', 'notify_assigned', expect.stringContaining('CS101 — Section 01'))
    expect(await screen.findByText('✓ Confirmed')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument()
  })

  it('marks the card failed and shows the error when the confirmed insert fails', async () => {
    vi.mocked(createMessage)
      .mockResolvedValueOnce(toolUseResponse('propose_assignment', { section_id: 'sec-1', instructor_id: 'inst-1' }))
      .mockResolvedValueOnce(textResponse('Handled.'))
    vi.mocked(buildAssignmentPreview).mockResolvedValue({
      kind: 'assignment', sectionId: 'sec-1', instructorId: 'inst-1',
      sectionLabel: 'CS101 — Section 01', instructorName: 'Jane Doe',
      hours: 3, dayTime: 'Monday 9:00 AM', blocked: false, reasons: []
    })
    vi.mocked(supabase.from).mockReturnValue({ insert: vi.fn().mockResolvedValue({ error: { message: 'db error' } }) } as never)
    const user = userEvent.setup()
    render(<AdminAI />)
    await sendMessage(user, 'assign jane to cs101')
    await screen.findByRole('button', { name: 'Confirm' })

    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('db error'))
    expect(await screen.findByText('✗ Failed: db error')).toBeInTheDocument()
    expect(notifyInstructor).not.toHaveBeenCalled()
    expect(logAction).not.toHaveBeenCalled()
  })

  it('cancelling a staged action never touches the database', async () => {
    vi.mocked(createMessage)
      .mockResolvedValueOnce(toolUseResponse('propose_assignment', { section_id: 'sec-1', instructor_id: 'inst-1' }))
      .mockResolvedValueOnce(textResponse('No problem.'))
    vi.mocked(buildAssignmentPreview).mockResolvedValue({
      kind: 'assignment', sectionId: 'sec-1', instructorId: 'inst-1',
      sectionLabel: 'CS101 — Section 01', instructorName: 'Jane Doe',
      hours: 3, dayTime: 'Monday 9:00 AM', blocked: false, reasons: []
    })
    const user = userEvent.setup()
    render(<AdminAI />)
    await sendMessage(user, 'assign jane to cs101')
    await screen.findByRole('button', { name: 'Cancel' })

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(await screen.findByText('✗ Cancelled')).toBeInTheDocument()
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('disables the input and Send while an action is pending, and re-enables it once resolved', async () => {
    vi.mocked(createMessage)
      .mockResolvedValueOnce(toolUseResponse('propose_assignment', { section_id: 'sec-1', instructor_id: 'inst-1' }))
      .mockResolvedValueOnce(textResponse('Okay.'))
    vi.mocked(buildAssignmentPreview).mockResolvedValue({
      kind: 'assignment', sectionId: 'sec-1', instructorId: 'inst-1',
      sectionLabel: 'CS101 — Section 01', instructorName: 'Jane Doe',
      hours: 3, dayTime: 'Monday 9:00 AM', blocked: false, reasons: []
    })
    const user = userEvent.setup()
    render(<AdminAI />)
    await sendMessage(user, 'assign jane to cs101')
    await screen.findByRole('button', { name: 'Cancel' })

    expect(screen.getByPlaceholderText('Resolve the pending action above first...')).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(screen.getByPlaceholderText('Ask something about your schedule...')).toBeEnabled())
  })

  it('does not send on Shift+Enter but does send on plain Enter', async () => {
    vi.mocked(createMessage).mockResolvedValue(textResponse('Reply.'))
    const user = userEvent.setup()
    render(<AdminAI />)
    const inputEl = screen.getByPlaceholderText('Ask something about your schedule...')

    await user.type(inputEl, 'hello{Shift>}{Enter}{/Shift}')
    expect(createMessage).not.toHaveBeenCalled()

    await user.type(inputEl, '{Enter}')
    expect(await screen.findByText('Reply.')).toBeInTheDocument()
  })
})
