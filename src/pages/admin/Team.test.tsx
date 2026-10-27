import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import toast from 'react-hot-toast'
import AdminTeam from './Team'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../stores/authStore'
import { logAction } from '../../lib/audit'

vi.mock('../../lib/supabase', () => ({
  supabase: { from: vi.fn(), functions: { invoke: vi.fn() } }
}))
vi.mock('../../stores/authStore', () => ({ useAuthStore: vi.fn() }))
vi.mock('../../lib/audit', () => ({ logAction: vi.fn() }))
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }))

const ME = { id: 'admin-1', full_name: 'Ada Admin', email: 'ada@college.ca', role: 'admin' as const }
const STAFF = [
  { id: 'admin-1', full_name: 'Ada Admin', email: 'ada@college.ca', role: 'admin', created_at: '2026-09-01T00:00:00Z' },
  { id: 'coord-1', full_name: 'Carl Coordinator', email: 'carl@college.ca', role: 'coordinator', created_at: '2026-09-02T00:00:00Z' },
  { id: 'admin-2', full_name: 'Bea Boss', email: 'bea@college.ca', role: 'admin', created_at: '2026-09-03T00:00:00Z' }
]

// from('profiles').select(...).in('role', [...]).order('full_name')
function mockStaff(rows = STAFF) {
  const inFn = vi.fn(() => ({ order: async () => ({ data: rows, error: null }) }))
  vi.mocked(supabase.from).mockImplementation((() => ({ select: () => ({ in: inFn }) })) as never)
  return inFn
}

async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>, opts: { name?: string; email?: string; role?: string } = {}) {
  if (opts.name !== undefined) await user.type(screen.getByLabelText('Full name'), opts.name)
  if (opts.email !== undefined) await user.type(screen.getByLabelText('Email address'), opts.email)
  if (opts.role) await user.selectOptions(screen.getByLabelText('Role'), opts.role)
  await user.click(screen.getByRole('button', { name: 'Send invitation' }))
}

describe('AdminTeam', () => {
  beforeEach(() => {
    vi.mocked(useAuthStore).mockReturnValue({ user: ME } as never)
    vi.mocked(supabase.functions.invoke).mockReset()
    vi.mocked(logAction).mockReset()
    vi.mocked(toast.error).mockReset()
    vi.mocked(toast.success).mockReset()
  })

  describe('the list', () => {
    it('shows administrators and coordinators with their roles, and marks the signed-in user', async () => {
      const inFn = mockStaff()
      render(<AdminTeam />)

      expect(await screen.findByText('Carl Coordinator')).toBeInTheDocument()
      expect(inFn).toHaveBeenCalledWith('role', ['admin', 'coordinator']) // never instructors
      const carl = screen.getByText('Carl Coordinator').closest('tr')!
      expect(within(carl).getByText('Coordinator')).toBeInTheDocument()
      const ada = screen.getByText('Ada Admin').closest('tr')!
      expect(within(ada).getByText('(you)')).toBeInTheDocument()
      expect(within(ada).getByText('Administrator')).toBeInTheDocument()
    })

    it('offers Remove for other people but never for yourself', async () => {
      mockStaff()
      render(<AdminTeam />)
      await screen.findByText('Carl Coordinator')

      expect(within(screen.getByText('Ada Admin').closest('tr')!).queryByRole('button')).not.toBeInTheDocument()
      expect(within(screen.getByText('Carl Coordinator').closest('tr')!).getByRole('button', { name: 'Remove' })).toBeInTheDocument()
    })
  })

  describe('inviting', () => {
    beforeEach(() => mockStaff())

    it('sends the invitation with the role and a link back to /set-password, then confirms and refreshes', async () => {
      vi.mocked(supabase.functions.invoke).mockResolvedValue({ data: { id: 'new-1' }, error: null } as never)
      const user = userEvent.setup()
      render(<AdminTeam />)
      await screen.findByText('Carl Coordinator')

      await fillAndSubmit(user, { name: '  Dana Lee ', email: 'Dana@College.CA', role: 'admin' })

      await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Invitation sent to dana@college.ca'))
      expect(supabase.functions.invoke).toHaveBeenCalledWith('manage-staff', {
        body: {
          action: 'invite', full_name: 'Dana Lee', email: 'dana@college.ca', role: 'admin',
          redirect_to: `${window.location.origin}/set-password`
        }
      })
      expect(supabase.from).toHaveBeenCalledTimes(2) // initial load + refresh
    })

    it('records the invitation without storing the person\'s name or email', async () => {
      vi.mocked(supabase.functions.invoke).mockResolvedValue({ data: { id: 'new-1' }, error: null } as never)
      const user = userEvent.setup()
      render(<AdminTeam />)
      await screen.findByText('Carl Coordinator')

      await fillAndSubmit(user, { name: 'Dana Lee', email: 'dana@college.ca' })

      await waitFor(() => expect(logAction).toHaveBeenCalledWith('admin-1', 'invited', 'staff', 'new-1', { role: 'coordinator' }))
    })

    it('clears the form after a successful invitation', async () => {
      vi.mocked(supabase.functions.invoke).mockResolvedValue({ data: { id: 'new-1' }, error: null } as never)
      const user = userEvent.setup()
      render(<AdminTeam />)
      await screen.findByText('Carl Coordinator')

      await fillAndSubmit(user, { name: 'Dana Lee', email: 'dana@college.ca', role: 'admin' })

      await waitFor(() => expect(screen.getByLabelText('Full name')).toHaveValue(''))
      expect(screen.getByLabelText('Email address')).toHaveValue('')
      expect(screen.getByLabelText('Role')).toHaveValue('coordinator')
    })

    it('explains what each role can do as it is selected', async () => {
      const user = userEvent.setup()
      render(<AdminTeam />)
      await screen.findByText('Carl Coordinator')

      expect(screen.getByText(/Read-only: can view the dashboard/)).toBeInTheDocument()
      await user.selectOptions(screen.getByLabelText('Role'), 'admin')
      expect(screen.getByText(/Full control: courses, sections/)).toBeInTheDocument()
    })

    it('shows the same validation messages as the server and sends nothing', async () => {
      const user = userEvent.setup()
      render(<AdminTeam />)
      await screen.findByText('Carl Coordinator')

      await fillAndSubmit(user, { name: 'D', email: 'dana@college.ca' })
      expect(await screen.findByRole('alert')).toHaveTextContent(/full name/i)

      await user.clear(screen.getByLabelText('Full name'))
      await user.type(screen.getByLabelText('Full name'), 'Dana Lee')
      await user.clear(screen.getByLabelText('Email address'))
      await user.type(screen.getByLabelText('Email address'), 'not-an-email')
      await user.click(screen.getByRole('button', { name: 'Send invitation' }))
      expect(await screen.findByRole('alert')).toHaveTextContent(/valid email/i)

      expect(supabase.functions.invoke).not.toHaveBeenCalled()
    })

    it('shows the server\'s own message, such as a plan limit, instead of a generic one', async () => {
      const message = 'You already have 25 administrator and coordinator accounts, which is the limit.'
      vi.mocked(supabase.functions.invoke).mockResolvedValue({
        data: null,
        error: Object.assign(new Error('Edge Function returned a non-2xx status code'), {
          context: { json: async () => ({ error: message, code: 'staff_limit' }) }
        })
      } as never)
      const user = userEvent.setup()
      render(<AdminTeam />)
      await screen.findByText('Carl Coordinator')

      await fillAndSubmit(user, { name: 'Dana Lee', email: 'dana@college.ca' })

      expect(await screen.findByRole('alert')).toHaveTextContent(message)
      expect(toast.success).not.toHaveBeenCalled()
      expect(logAction).not.toHaveBeenCalled()
      expect(screen.getByLabelText('Full name')).toHaveValue('Dana Lee') // kept so it can be corrected
    })
  })

  describe('removing', () => {
    beforeEach(() => mockStaff())

    it('asks for confirmation first and does nothing if cancelled', async () => {
      const user = userEvent.setup()
      render(<AdminTeam />)
      await screen.findByText('Carl Coordinator')

      const row = screen.getByText('Carl Coordinator').closest('tr')!
      await user.click(within(row).getByRole('button', { name: 'Remove' }))
      expect(within(row).getByText('Remove Carl Coordinator?')).toBeInTheDocument()
      expect(supabase.functions.invoke).not.toHaveBeenCalled()

      await user.click(within(row).getByRole('button', { name: 'Cancel' }))
      expect(within(row).queryByText(/Remove Carl/)).not.toBeInTheDocument()
      expect(supabase.functions.invoke).not.toHaveBeenCalled()
    })

    it('removes the account once confirmed, records it without personal details, and refreshes', async () => {
      vi.mocked(supabase.functions.invoke).mockResolvedValue({ data: { success: true }, error: null } as never)
      const user = userEvent.setup()
      render(<AdminTeam />)
      await screen.findByText('Carl Coordinator')

      const row = screen.getByText('Carl Coordinator').closest('tr')!
      await user.click(within(row).getByRole('button', { name: 'Remove' }))
      await user.click(within(row).getByRole('button', { name: 'Confirm remove' }))

      await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Account removed'))
      expect(supabase.functions.invoke).toHaveBeenCalledWith('manage-staff', { body: { action: 'remove', user_id: 'coord-1' } })
      expect(logAction).toHaveBeenCalledWith('admin-1', 'removed', 'staff', 'coord-1', { role: 'coordinator' })
      expect(supabase.from).toHaveBeenCalledTimes(2)
    })

    it('shows the reason and keeps the account listed when removal is refused', async () => {
      vi.mocked(supabase.functions.invoke).mockResolvedValue({ data: { error: 'That account was not found.' }, error: null } as never)
      const user = userEvent.setup()
      render(<AdminTeam />)
      await screen.findByText('Bea Boss')

      const row = screen.getByText('Bea Boss').closest('tr')!
      await user.click(within(row).getByRole('button', { name: 'Remove' }))
      await user.click(within(row).getByRole('button', { name: 'Confirm remove' }))

      await waitFor(() => expect(toast.error).toHaveBeenCalledWith('That account was not found.'))
      expect(logAction).not.toHaveBeenCalled()
      expect(screen.getByText('Bea Boss')).toBeInTheDocument()
    })
  })
})
