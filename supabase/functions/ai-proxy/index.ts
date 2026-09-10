// Proxies every Claude call (Scheduling Copilot, Auto-Scheduler, Resume Parser,
// Smart CSV Import, Weekly Digest) through the server so the Anthropic API key
// never ships to the browser. The client sends the same params it would have
// passed to `anthropic.messages.create()`; this forwards them to the real
// Anthropic API using a server-only secret and returns the response verbatim.
//
// Deploy with: supabase functions deploy ai-proxy
// Then set the secret once: supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
// (SUPABASE_URL / SUPABASE_ANON_KEY are injected automatically.)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Missing authorization' }, 401)

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } }
    })
    const { data: { user: caller }, error: callerError } = await callerClient.auth.getUser()
    if (callerError || !caller) return json({ error: 'Not authenticated' }, 401)

    // Every AI feature in the app (Copilot, Auto-Scheduler, Resume Parser,
    // Smart CSV Import, Weekly Digest) is only ever surfaced on admin-only
    // pages, so this proxy only serves admins.
    const { data: profile } = await callerClient.from('profiles').select('role').eq('id', caller.id).single()
    if (profile?.role !== 'admin') return json({ error: 'Only admins can use AI features' }, 403)

    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!anthropicKey) return json({ error: 'Server is not configured with an Anthropic API key' }, 500)

    const body = await req.json()
    const { model, max_tokens, system, tools, tool_choice, messages } = body
    if (!model || !max_tokens || !messages) {
      return json({ error: 'model, max_tokens, and messages are required' }, 400)
    }

    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({ model, max_tokens, system, tools, tool_choice, messages })
    })

    const data = await anthropicRes.json()
    return json(data, anthropicRes.status)
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Unexpected error' }, 500)
  }
})
