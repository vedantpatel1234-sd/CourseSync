import { describe, it, expect, vi, beforeEach } from 'vitest'
import { normalizeHeader, tryDirectMapping, suggestColumnMapping, type TargetField } from './csvMapper'
import { createMessage } from './anthropic'

vi.mock('./anthropic', () => ({
  createMessage: vi.fn(),
  COPILOT_MODEL: 'claude-opus-5'
}))

const FIELDS: TargetField[] = [
  { key: 'code', label: 'Course Code', required: true },
  { key: 'name', label: 'Course Name', required: true },
  { key: 'notes', label: 'Notes', required: false }
]

describe('normalizeHeader', () => {
  it('lowercases and strips non-alphanumeric characters', () => {
    expect(normalizeHeader('Course Code')).toBe('coursecode')
    expect(normalizeHeader('E-Mail Address!')).toBe('emailaddress')
    expect(normalizeHeader('code')).toBe('code')
  })
})

describe('tryDirectMapping', () => {
  it('matches headers whose normalized text equals the target key', () => {
    const result = tryDirectMapping(['Code', 'Name'], FIELDS)
    expect(result).toEqual({ code: 'Code', name: 'Name', notes: null })
  })

  it('returns null when a required field has no matching header', () => {
    const result = tryDirectMapping(['Name'], FIELDS)
    expect(result).toBeNull()
  })

  it('does not fail on a missing optional field', () => {
    const result = tryDirectMapping(['code', 'name'], FIELDS)
    expect(result).toEqual({ code: 'code', name: 'name', notes: null })
  })
})

describe('suggestColumnMapping', () => {
  beforeEach(() => {
    vi.mocked(createMessage).mockReset()
  })

  it('maps target fields from the tool_use response', async () => {
    vi.mocked(createMessage).mockResolvedValue({
      content: [{
        type: 'tool_use',
        id: 'tool_1',
        name: 'submit_column_mapping',
        input: {
          mappings: [
            { target_key: 'code', csv_header: 'Course #' },
            { target_key: 'name', csv_header: 'Title' },
            { target_key: 'notes', csv_header: '' }
          ]
        }
      }]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)

    const result = await suggestColumnMapping(['Course #', 'Title'], FIELDS)
    expect(result).toEqual({ code: 'Course #', name: 'Title', notes: null })
  })

  it('discards a mapped header the model invented that is not in the real CSV headers', async () => {
    vi.mocked(createMessage).mockResolvedValue({
      content: [{
        type: 'tool_use',
        id: 'tool_1',
        name: 'submit_column_mapping',
        input: {
          mappings: [{ target_key: 'code', csv_header: 'Made Up Column' }]
        }
      }]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)

    const result = await suggestColumnMapping(['Course #'], [FIELDS[0]])
    expect(result.code).toBeNull()
  })

  it('defaults every field to null when the model returns no tool_use block', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(createMessage).mockResolvedValue({ content: [] } as any)

    const result = await suggestColumnMapping(['Course #'], FIELDS)
    expect(result).toEqual({ code: null, name: null, notes: null })
  })
})
