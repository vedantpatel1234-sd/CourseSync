// Proxies every Claude call (Scheduling Copilot, Auto-Scheduler, Resume Parser,
// Smart CSV Import, Weekly Digest) through the server so the Anthropic API key
// never ships to the browser. The client sends the same params it would have
// passed to `anthropic.messages.create()`; this forwards them to the real
// Anthropic API using a server-only secret and returns the response verbatim.
//
// It also enforces the organization's plan (account in good standing, AI switched on, monthly
// token allowance) and records every call's token usage. Model and output size are decided
// here, not by the browser. Rules live in ../_shared/entitlements.ts.
//
// Deploy with: supabase functions deploy ai-proxy
// Then set the secret once: supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
// (SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are injected automatically.)
// Requires migration 012 (organization_billing, ai_usage) to have been run first.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { checkCanUseAi, sanitizeAiRequest } from '../_shared/entitlements.ts'

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

// Errors the app shows to the admin. `code` lets the client react without parsing the message.
function denied(status: number, code: string, error: string) {
  return json({ error, code }, status)
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
    const { data: profile } = await callerClient
      .from('profiles').select('role, organization_id').eq('id', caller.id).single()
    if (profile?.role !== 'admin') return json({ error: 'Only admins can use AI features' }, 403)
    const organizationId: string = profile.organization_id

    // Plan enforcement reads billing and usage with the service role (admins can read their own
    // billing row, but only the server may write usage). Fails closed: if the billing row can't
    // be read, no AI call is made.
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const admin = createClient(supabaseUrl, serviceRoleKey)

    const { data: billing, error: billingError } = await admin
      .from('organization_billing')
      .select('subscription_status, trial_ends_at, max_instructors, ai_enabled, ai_monthly_token_limit')
      .eq('organization_id', organizationId)
      .single()
    if (billingError || !billing) {
      return denied(403, 'billing_unavailable', 'Billing is not set up for this organization. Contact us.')
    }

    const { data: used, error: usedError } = await admin.rpc('ai_tokens_used_this_month', { p_org: organizationId })
    if (usedError) return denied(500, 'usage_unavailable', 'Could not check your AI allowance. Try again shortly.')

    const allowed = checkCanUseAi(billing, Number(used ?? 0))
    if (!allowed.ok) return denied(allowed.status, allowed.code, allowed.error)

    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!anthropicKey) return json({ error: 'Server is not configured with an Anthropic API key' }, 500)

    const request = sanitizeAiRequest(await req.json())
    if (!request.ok) return denied(request.status, request.code, request.error)
    const { model, max_tokens, system, tools, tool_choice, messages } = request.params

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

    // Record what this call cost. A failure to record must not fail the admin's request.
    if (anthropicRes.ok && data?.usage) {
      const { error: usageError } = await admin.from('ai_usage').insert({
        organization_id: organizationId,
        user_id: caller.id,
        model,
        input_tokens: data.usage.input_tokens ?? 0,
        output_tokens: data.usage.output_tokens ?? 0
      })
      if (usageError) console.error('Failed to record AI usage:', usageError.message)
    }

    return json(data, anthropicRes.status)
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Unexpected error' }, 500)
  }
})
