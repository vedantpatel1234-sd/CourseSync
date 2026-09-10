import type Anthropic from '@anthropic-ai/sdk'
import { createMessage, COPILOT_MODEL } from './anthropic'

export interface TargetField {
  key: string
  label: string
  required: boolean
}

const MAPPING_TOOL: Anthropic.Tool = {
  name: 'submit_column_mapping',
  description: 'Submit the best matching CSV column header for each target field.',
  input_schema: {
    type: 'object',
    properties: {
      mappings: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            target_key: { type: 'string' },
            csv_header: { type: 'string', description: 'The exact CSV header string that corresponds to this target field. Empty string if nothing in the CSV corresponds to it.' }
          },
          required: ['target_key', 'csv_header']
        }
      }
    },
    required: ['mappings']
  }
}

const SYSTEM_PROMPT = `You map spreadsheet column headers to a fixed set of target fields for a data import tool. For each target field, pick the CSV header that clearly corresponds to it by meaning, not just exact text — e.g. "Instructor Email" or "E-mail Address" matches a target field with key "email"; "Course #" or "Code" matches "code". Only match a header when you're genuinely confident — leave csv_header as an empty string if nothing in the CSV corresponds to a target field. Never invent a header that isn't in the list you were given. Call submit_column_mapping exactly once, with one entry per target field.`

export async function suggestColumnMapping(csvHeaders: string[], targetFields: TargetField[]): Promise<Record<string, string | null>> {
  const response = await createMessage({
    model: COPILOT_MODEL,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    tools: [MAPPING_TOOL],
    tool_choice: { type: 'tool', name: 'submit_column_mapping' },
    messages: [{
      role: 'user',
      content: `CSV headers: ${JSON.stringify(csvHeaders)}\n\nTarget fields: ${JSON.stringify(targetFields.map(f => ({ key: f.key, label: f.label, required: f.required })))}`
    }]
  })

  const toolUse = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'submit_column_mapping')
  const input = (toolUse?.input || { mappings: [] }) as { mappings: { target_key: string; csv_header: string }[] }

  const result: Record<string, string | null> = {}
  for (const field of targetFields) {
    const match = input.mappings.find(m => m.target_key === field.key)
    result[field.key] = match && match.csv_header && csvHeaders.includes(match.csv_header) ? match.csv_header : null
  }
  return result
}

export function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * Tries a direct, no-AI header match first: every required field must have a CSV
 * header whose normalized text equals the target key's normalized text. Only when
 * this fails for at least one required field do we fall back to suggestColumnMapping.
 */
export function tryDirectMapping(csvHeaders: string[], targetFields: TargetField[]): Record<string, string | null> | null {
  const result: Record<string, string | null> = {}
  for (const field of targetFields) {
    const match = csvHeaders.find(h => normalizeHeader(h) === normalizeHeader(field.key))
    result[field.key] = match || null
    if (field.required && !match) return null
  }
  return result
}
