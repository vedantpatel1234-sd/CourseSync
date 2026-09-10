import type Anthropic from '@anthropic-ai/sdk'
import { supabase } from './supabase'

export const COPILOT_MODEL = 'claude-opus-5'

interface CreateMessageParams {
  model: string
  max_tokens: number
  system?: string
  tools?: Anthropic.Tool[]
  tool_choice?: Anthropic.ToolChoice
  messages: Anthropic.MessageParam[]
}

// Every AI feature calls Claude through this instead of the SDK directly —
// the actual request goes to the ai-proxy Edge Function, which holds the
// real Anthropic API key server-side. Nothing here ever exposes the key to
// the browser. The params/response shape matches `anthropic.messages.create()`
// so every call site reads `response.content` exactly as it would with the
// SDK.
export async function createMessage(params: CreateMessageParams): Promise<Anthropic.Message> {
  const { data, error } = await supabase.functions.invoke('ai-proxy', { body: params })

  if (error) {
    const ctx = (error as { context?: Response }).context
    if (ctx && typeof ctx.json === 'function') {
      const body = await ctx.json().catch(() => null)
      if (body) throw new Error(body.error?.message || body.error || JSON.stringify(body))
    }
    throw new Error(error.message || 'AI request failed')
  }

  if (data?.error) {
    throw new Error(typeof data.error === 'string' ? data.error : (data.error?.message || JSON.stringify(data.error)))
  }

  return data as Anthropic.Message
}
