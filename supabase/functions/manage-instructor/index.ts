// Invites and deletes instructor accounts using the service role key, entirely
// server-side. New instructors are invited by email and choose their own
// password from the link — no admin ever sees or types one.
//
// This exists because supabase-js's client-side `auth.signUp()` and
// `auth.admin.*` calls operate on whatever session is currently active in the
// browser — calling them from an already-logged-in admin's session silently
// replaces the admin's own session with the new/deleted user's. Doing this in an
// Edge Function with the service role key means the admin's browser session is
// never touched.
//
// Deploy with: supabase functions deploy manage-instructor
// (SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY are injected
// automatically by the Supabase platform — no manual secrets to set.)

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

// supabase-js sends the invite email with this as the landing page; Supabase
// itself only honours URLs on the project's Redirect URL allow-list.
function parseRedirect(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value) return undefined
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : undefined
  } catch {
    return undefined
  }
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
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    // Verify the caller is an authenticated admin. This function uses the
    // service role key, which bypasses every restriction — without this check
    // any logged-in user could create or delete instructor accounts.
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } }
    })
    const { data: { user: caller }, error: callerError } = await callerClient.auth.getUser()
    if (callerError || !caller) return json({ error: 'Not authenticated' }, 401)

    const admin = createClient(supabaseUrl, serviceRoleKey)

    const { data: callerProfile } = await admin
      .from('profiles')
      .select('role')
      .eq('id', caller.id)
      .single()

    if (callerProfile?.role !== 'admin') {
      return json({ error: 'Only admins can manage instructor accounts' }, 403)
    }

    const body = await req.json()

    if (body.action === 'create') {
      const { full_name, email, department, title, max_hours_per_term } = body
      if (!full_name || !email) return json({ error: 'full_name and email are required' }, 400)

      const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
        redirectTo: parseRedirect(body.redirect_to)
      })
      if (inviteError || !invited.user) {
        return json({ error: inviteError?.message || 'Failed to send invitation' }, 400)
      }

      const { error: profileError } = await admin.from('profiles').insert({
        id: invited.user.id,
        full_name,
        email,
        role: 'instructor'
      })
      if (profileError) {
        await admin.auth.admin.deleteUser(invited.user.id)
        return json({ error: profileError.message }, 400)
      }

      const { error: instProfileError } = await admin.from('instructor_profiles').insert({
        user_id: invited.user.id,
        department: department || 'Unknown',
        title: title || 'Instructor',
        max_hours_per_term: max_hours_per_term || 40
      })
      if (instProfileError) {
        await admin.auth.admin.deleteUser(invited.user.id)
        return json({ error: instProfileError.message }, 400)
      }

      return json({ id: invited.user.id })
    }

    if (body.action === 'delete') {
      const { instructor_id } = body
      if (!instructor_id) return json({ error: 'instructor_id is required' }, 400)

      await admin.from('profiles').delete().eq('id', instructor_id)

      const { error: deleteError } = await admin.auth.admin.deleteUser(instructor_id)
      if (deleteError) {
        return json({ error: `Profile removed, but the login account could not be deleted: ${deleteError.message}` })
      }

      return json({ success: true })
    }

    return json({ error: `Unknown action: ${body.action}` }, 400)
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Unexpected error' }, 500)
  }
})
