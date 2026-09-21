import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import toast from 'react-hot-toast'
import AdminImport from './Import'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../stores/authStore'
import { logAction } from '../../lib/audit'
import { tryDirectMapping, suggestColumnMapping } from '../../lib/csvMapper'
import { validateCourseRows, validateInstructorRows } from '../../lib/importValidation'

vi.mock('../../lib/supabase', () => ({ supabase: { from: vi.fn(), functions: { invoke: vi.fn() } } }))
vi.mock('../../stores/authStore', () => ({ useAuthStore: vi.fn() }))
vi.mock('../../lib/audit', () => ({ logAction: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../../lib/csvMapper', () => ({ tryDirectMapping: vi.fn(), suggestColumnMapping: vi.fn() }))
vi.mock('../../lib/importValidation', () => ({ validateCourseRows: vi.fn(), validateInstructorRows: vi.fn() }))
vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() })
}))

const ADMIN_USER = { id: 'admin-1', full_name: 'Admin', email: 'admin@example.com', role: 'admin' as const }

function csvFile(content: string, name = 'data.csv') {
  return new File([content], name, { type: 'text/csv' })
}

async function uploadFile(file: File) {
  const input = document.getElementById('csvInput') as HTMLInputElement
  await userEvent.upload(input, file)
}

describe('AdminImport', () => {
  beforeEach(() => {
    vi.mocked(useAuthStore).mockReturnValue({ user: ADMIN_USER } as never)
    vi.mocked(toast).mockReset()
    vi.mocked(toast.error).mockReset()
    vi.mocked(toast.success).mockReset()
    vi.mocked(logAction).mockClear()
    vi.mocked(tryDirectMapping).mockReset()
    vi.mocked(suggestColumnMapping).mockReset()
    vi.mocked(validateCourseRows).mockReset().mockResolvedValue([])
    vi.mocked(validateInstructorRows).mockReset().mockResolvedValue([])
    vi.mocked(supabase.from).mockReset()
    vi.mocked(supabase.functions.invoke).mockReset()
  })

  it('rejects a non-CSV file', async () => {
    render(<AdminImport />)
    const input = document.getElementById('csvInput') as HTMLInputElement
    const file = new File(['x'], 'resume.pdf', { type: 'application/pdf' })
    // userEvent.upload enforces the input's accept=".csv" like a real OS picker and
    // would silently skip this file — dispatch the change event directly to exercise
    // the app's own JS-level extension check instead.
    fireEvent.change(input, { target: { files: [file] } })
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Please upload a CSV file'))
  })

  it('skips AI mapping and shows the preview immediately when headers match directly', async () => {
    vi.mocked(tryDirectMapping).mockReturnValue({ code: 'Code', name: 'Name', description: null })
    render(<AdminImport />)

    await uploadFile(csvFile('Code,Name\nCS101,Intro to CS\n'))

    expect(await screen.findByText('Preview — 1 rows')).toBeInTheDocument()
    expect(screen.queryByText('✨ Column mapping')).not.toBeInTheDocument()
    expect(suggestColumnMapping).not.toHaveBeenCalled()
  })

  it('falls back to AI-suggested mapping when headers do not match directly', async () => {
    vi.mocked(tryDirectMapping).mockReturnValue(null)
    vi.mocked(suggestColumnMapping).mockResolvedValue({ code: 'Course #', name: 'Title', description: null })
    render(<AdminImport />)

    await uploadFile(csvFile('Course #,Title\nCS101,Intro to CS\n'))

    expect(await screen.findByText('✨ Column mapping')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByDisplayValue('Course #')).toBeInTheDocument())
    expect(screen.getByDisplayValue('Title')).toBeInTheDocument()
  })

  it('falls back to an unmapped, manually-editable form when the AI suggestion fails', async () => {
    vi.mocked(tryDirectMapping).mockReturnValue(null)
    vi.mocked(suggestColumnMapping).mockRejectedValue(new Error('Your credit balance is too low.'))
    render(<AdminImport />)

    await uploadFile(csvFile('Foo,Bar\nCS101,Intro to CS\n'))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(
      "Could not auto-suggest column mapping: Your credit balance is too low.. Please map columns manually below."
    ))
    expect(screen.getByRole('button', { name: 'Apply Mapping & Continue' })).toBeDisabled()
  })

  it('disables "Apply Mapping & Continue" until every required field is mapped', async () => {
    vi.mocked(tryDirectMapping).mockReturnValue(null)
    vi.mocked(suggestColumnMapping).mockResolvedValue({ code: 'Course #', name: null, description: null })
    const user = userEvent.setup()
    render(<AdminImport />)
    await uploadFile(csvFile('Course #,Other\nCS101,x\n'))
    await screen.findByDisplayValue('Course #')

    const applyButton = screen.getByRole('button', { name: 'Apply Mapping & Continue' })
    expect(applyButton).toBeDisabled()

    // Selects are Code, Name, Description in that order; Name is the unmapped required one.
    const nameSelect = document.querySelectorAll('select')[1]
    await user.selectOptions(nameSelect, 'Other')
    expect(applyButton).toBeEnabled()
  })

  it('shows a skip count for rows with validation issues and adjusts the import count', async () => {
    vi.mocked(tryDirectMapping).mockReturnValue({ code: 'Code', name: 'Name', description: null })
    vi.mocked(validateCourseRows).mockResolvedValue([{ rowIndex: 1, message: 'Duplicate code "CS101" within this file' }])
    render(<AdminImport />)

    await uploadFile(csvFile('Code,Name\nCS101,Intro\nCS101,Intro Again\n'))

    expect(await screen.findByText('1 row will be skipped')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Import 1 courses' })).toBeInTheDocument()
  })

  it('imports valid course rows and logs the count, skipping invalid ones', async () => {
    vi.mocked(tryDirectMapping).mockReturnValue({ code: 'Code', name: 'Name', description: null })
    vi.mocked(validateCourseRows).mockResolvedValue([{ rowIndex: 1, message: 'Missing course name' }])
    const insert = vi.fn().mockResolvedValue({ error: null })
    vi.mocked(supabase.from).mockReturnValue({ insert } as never)
    const user = userEvent.setup()
    render(<AdminImport />)
    await uploadFile(csvFile('Code,Name\nCS101,Intro to CS\nCS102,\n'))
    await screen.findByRole('button', { name: 'Import 1 courses' })

    await user.click(screen.getByRole('button', { name: 'Import 1 courses' }))

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('1 courses imported successfully!'))
    expect(insert).toHaveBeenCalledTimes(1)
    expect(insert).toHaveBeenCalledWith({ code: 'CS101', name: 'Intro to CS', description: null })
    expect(logAction).toHaveBeenCalledWith('admin-1', 'imported', 'course', undefined, { count: 1 })
  })

  it('imports instructors via the manage-instructor function and displays their temporary passwords', async () => {
    vi.mocked(tryDirectMapping).mockReturnValue({ full_name: 'Name', email: 'Email', department: null, title: null, max_hours: null })
    vi.mocked(validateInstructorRows).mockResolvedValue([])
    vi.mocked(supabase.functions.invoke).mockResolvedValue({
      data: { id: 'inst-1', password: 'Temp1234!' }, error: null
    } as never)
    const user = userEvent.setup()
    render(<AdminImport />)

    await user.click(screen.getByRole('button', { name: 'Instructors' }))
    await uploadFile(csvFile('Name,Email\nJane Doe,jane@example.com\n'))
    await screen.findByRole('button', { name: 'Import 1 instructors' })

    await user.click(screen.getByRole('button', { name: 'Import 1 instructors' }))

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('1 instructors imported successfully!'))
    expect(screen.getByText('Jane Doe')).toBeInTheDocument()
    expect(screen.getByText('Temp1234!')).toBeInTheDocument()
    expect(logAction).toHaveBeenCalledWith('admin-1', 'imported', 'instructor', undefined, { count: 1 })
  })

  it('counts a failed instructor invoke as an error and does not list it among credentials', async () => {
    vi.mocked(tryDirectMapping).mockReturnValue({ full_name: 'Name', email: 'Email', department: null, title: null, max_hours: null })
    vi.mocked(validateInstructorRows).mockResolvedValue([])
    vi.mocked(supabase.functions.invoke).mockResolvedValue({ data: { error: 'Email already in use' }, error: null } as never)
    const user = userEvent.setup()
    render(<AdminImport />)
    await user.click(screen.getByRole('button', { name: 'Instructors' }))
    await uploadFile(csvFile('Name,Email\nJane Doe,jane@example.com\n'))
    await screen.findByRole('button', { name: 'Import 1 instructors' })

    await user.click(screen.getByRole('button', { name: 'Import 1 instructors' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('1 rows failed on import — check for duplicates created since validation ran'))
    expect(screen.queryByText('Jane Doe')).not.toBeInTheDocument()
  })

  it('resets the file state when switching import type tabs', async () => {
    vi.mocked(tryDirectMapping).mockReturnValue({ code: 'Code', name: 'Name', description: null })
    const user = userEvent.setup()
    render(<AdminImport />)
    await uploadFile(csvFile('Code,Name\nCS101,Intro to CS\n'))
    await screen.findByText('Preview — 1 rows')

    await user.click(screen.getByRole('button', { name: 'Instructors' }))

    expect(screen.queryByText(/Preview —/)).not.toBeInTheDocument()
    expect(screen.getByText('Drop your CSV file here')).toBeInTheDocument()
  })
})
