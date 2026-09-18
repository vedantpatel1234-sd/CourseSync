import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import AdminCalendar from './Calendar'
import { supabase } from '../../lib/supabase'

vi.mock('../../lib/supabase', () => ({
  supabase: { from: vi.fn() }
}))

type Filter = { field: string; op: 'eq' | 'neq' | 'is' | 'in'; value: unknown }

function makeChain(rows: Record<string, unknown>[]) {
  const filters: Filter[] = []
  const chain: PromiseLike<{ data: unknown; error: null }> & Record<string, unknown> = {
    select: () => chain,
    order: () => chain,
    eq: (field: string, value: unknown) => { filters.push({ field, op: 'eq', value }); return chain },
    neq: (field: string, value: unknown) => { filters.push({ field, op: 'neq', value }); return chain },
    is: (field: string, value: unknown) => { filters.push({ field, op: 'is', value }); return chain },
    in: (field: string, value: unknown[]) => { filters.push({ field, op: 'in', value }); return chain },
    then: (resolve: (v: { data: unknown; error: null }) => unknown) => {
      const filtered = rows.filter(r => filters.every(f => {
        if (f.op === 'in') return (f.value as unknown[]).includes(r[f.field])
        if (f.op === 'neq') return r[f.field] !== f.value
        return r[f.field] === f.value
      }))
      return Promise.resolve({ data: filtered, error: null }).then(resolve)
    }
  } as never
  return chain
}

function mockTables(tables: Record<string, Record<string, unknown>[]>) {
  vi.mocked(supabase.from).mockImplementation(((table: string) => makeChain(tables[table] ?? [])) as never)
}

const TERMS = [
  { id: 'term-1', name: 'Fall 2025', is_active: false },
  { id: 'term-2', name: 'Winter 2026', is_active: true }
]

const SECTIONS = [
  { id: 'sec-1', term_id: 'term-2', section_number: '01', hours_required: 3, status: 'filled', day_of_week: 'Monday', time_slot: '9:00 AM', course: { code: 'COMP2205', name: 'Data Structures' } },
  { id: 'sec-2', term_id: 'term-2', section_number: '01', hours_required: 3, status: 'unassigned', day_of_week: 'Monday', time_slot: '9:00 AM', course: { code: 'MATH1010', name: 'Calculus' } },
  { id: 'sec-3', term_id: 'term-2', section_number: '01', hours_required: 3, status: 'unassigned', day_of_week: null, time_slot: null, course: { code: 'PHYS1000', name: 'Physics' } },
  { id: 'sec-4', term_id: 'term-1', section_number: '01', hours_required: 3, status: 'filled', day_of_week: 'Tuesday', time_slot: '10:00 AM', course: { code: 'ENGL1000', name: 'English' } }
]

const ASSIGNMENTS = [
  { section_id: 'sec-1', draft_id: null, status: 'active', instructor: { full_name: 'Jane Doe' } }
]

function renderCalendar() {
  return render(<MemoryRouter><AdminCalendar /></MemoryRouter>)
}

describe('AdminCalendar', () => {
  beforeEach(() => {
    vi.mocked(supabase.from).mockReset()
  })

  it('defaults to the active term and shows its schedule', async () => {
    mockTables({ terms: TERMS, sections: SECTIONS, assignments: ASSIGNMENTS })
    renderCalendar()

    expect(await screen.findByText('COMP2205 §01')).toBeInTheDocument()
    expect(screen.getByRole('combobox')).toHaveValue('term-2')
  })

  it('shows the assigned instructor name on a filled section and "Unassigned" on an open one', async () => {
    mockTables({ terms: TERMS, sections: SECTIONS, assignments: ASSIGNMENTS })
    renderCalendar()

    const filledCell = (await screen.findByText('COMP2205 §01')).closest('a')!
    expect(within(filledCell).getByText('Jane Doe')).toBeInTheDocument()

    const openCell = screen.getByText('MATH1010 §01').closest('a')!
    expect(within(openCell).getByText('Unassigned')).toBeInTheDocument()
  })

  it('lists sections with no day/time under "Not on the calendar"', async () => {
    mockTables({ terms: TERMS, sections: SECTIONS, assignments: ASSIGNMENTS })
    renderCalendar()

    expect(await screen.findByText('Not on the calendar (1)')).toBeInTheDocument()
    expect(screen.getByText('PHYS1000 §01')).toBeInTheDocument()
  })

  it('does not show the "Not on the calendar" panel when every section is scheduled', async () => {
    mockTables({ terms: TERMS, sections: SECTIONS.filter(s => s.id !== 'sec-3'), assignments: ASSIGNMENTS })
    renderCalendar()

    await screen.findByText('COMP2205 §01')
    expect(screen.queryByText(/Not on the calendar/)).not.toBeInTheDocument()
  })

  it('refetches the schedule for a different term when the dropdown changes', async () => {
    mockTables({ terms: TERMS, sections: SECTIONS, assignments: ASSIGNMENTS })
    const user = userEvent.setup()
    renderCalendar()
    await screen.findByText('COMP2205 §01')

    await user.selectOptions(screen.getByRole('combobox'), 'term-1')

    expect(await screen.findByText('ENGL1000 §01')).toBeInTheDocument()
    expect(screen.queryByText('COMP2205 §01')).not.toBeInTheDocument()
  })

  it('falls back to the first term when no term is marked active', async () => {
    const noActiveTerms = [{ id: 'term-1', name: 'Fall 2025', is_active: false }, { id: 'term-2', name: 'Winter 2026', is_active: false }]
    mockTables({ terms: noActiveTerms, sections: SECTIONS, assignments: ASSIGNMENTS })
    renderCalendar()

    expect(await screen.findByText('ENGL1000 §01')).toBeInTheDocument()
    expect(screen.getByRole('combobox')).toHaveValue('term-1')
  })
})
