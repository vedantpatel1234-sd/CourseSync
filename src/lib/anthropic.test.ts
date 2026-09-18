import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMessage } from './anthropic'
import { supabase } from './supabase'

vi.mock('./supabase', () => ({
  supabase: { functions: { invoke: vi.fn() } }
}))

const BASE_PARAMS = { model: 'claude-opus-5', max_tokens: 100, messages: [{ role: 'user' as const, content: 'hi' }] }

describe('createMessage', () => {
  beforeEach(() => {
    vi.mocked(supabase.functions.invoke).mockReset()
  })

  it('returns the response data on success', async () => {
    const message = { id: 'msg_1', content: [{ type: 'text', text: 'hello' }] }
    vi.mocked(supabase.functions.invoke).mockResolvedValue({ data: message, error: null } as never)

    const result = await createMessage(BASE_PARAMS)
    expect(result).toEqual(message)
    expect(supabase.functions.invoke).toHaveBeenCalledWith('ai-proxy', { body: BASE_PARAMS })
  })

  it('throws the proxy error body message when the invoke error carries a JSON context', async () => {
    const context = { json: vi.fn().mockResolvedValue({ error: { message: 'Your credit balance is too low.' } }) }
    vi.mocked(supabase.functions.invoke).mockResolvedValue({
      data: null, error: { message: 'Edge Function returned a non-2xx status code', context }
    } as never)

    await expect(createMessage(BASE_PARAMS)).rejects.toThrow('Your credit balance is too low.')
  })

  it('throws a string error body verbatim', async () => {
    const context = { json: vi.fn().mockResolvedValue({ error: 'invalid x-api-key' }) }
    vi.mocked(supabase.functions.invoke).mockResolvedValue({
      data: null, error: { message: 'non-2xx', context }
    } as never)

    await expect(createMessage(BASE_PARAMS)).rejects.toThrow('invalid x-api-key')
  })

  it('falls back to the generic invoke error message when the context has no usable JSON body', async () => {
    const context = { json: vi.fn().mockResolvedValue(null) }
    vi.mocked(supabase.functions.invoke).mockResolvedValue({
      data: null, error: { message: 'Edge Function returned a non-2xx status code', context }
    } as never)

    await expect(createMessage(BASE_PARAMS)).rejects.toThrow('Edge Function returned a non-2xx status code')
  })

  it('falls back to the generic invoke error message when context.json() itself rejects', async () => {
    const context = { json: vi.fn().mockRejectedValue(new Error('body already consumed')) }
    vi.mocked(supabase.functions.invoke).mockResolvedValue({
      data: null, error: { message: 'Edge Function returned a non-2xx status code', context }
    } as never)

    await expect(createMessage(BASE_PARAMS)).rejects.toThrow('Edge Function returned a non-2xx status code')
  })

  it('falls back to a generic message when there is no error.message and no context', async () => {
    vi.mocked(supabase.functions.invoke).mockResolvedValue({ data: null, error: {} } as never)
    await expect(createMessage(BASE_PARAMS)).rejects.toThrow('AI request failed')
  })

  it('throws when invoke succeeds but the payload carries its own string error', async () => {
    vi.mocked(supabase.functions.invoke).mockResolvedValue({ data: { error: 'model overloaded' }, error: null } as never)
    await expect(createMessage(BASE_PARAMS)).rejects.toThrow('model overloaded')
  })

  it('throws when invoke succeeds but the payload carries its own object error with a message', async () => {
    vi.mocked(supabase.functions.invoke).mockResolvedValue({ data: { error: { message: 'rate limited' } }, error: null } as never)
    await expect(createMessage(BASE_PARAMS)).rejects.toThrow('rate limited')
  })

  it('stringifies a payload error object that has no message field', async () => {
    vi.mocked(supabase.functions.invoke).mockResolvedValue({ data: { error: { code: 500 } }, error: null } as never)
    await expect(createMessage(BASE_PARAMS)).rejects.toThrow('{"code":500}')
  })
})
