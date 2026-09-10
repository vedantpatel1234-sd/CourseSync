// Creates and deletes instructor accounts using the service role key, entirely
// server-side. This exists because supabase-js's client-side `auth.signUp()` and
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

function randomPassword() {
  const part = crypto.randomUUID().replace(/-/g, '').slice(0, 10)
  return `Cs${part}1!`
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
      const { full_name, email, password, department, title, max_hours_per_term } = body
      if (!full_name || !email) return json({ error: 'full_name and email are required' }, 400)

      const finalPassword: string = password || randomPassword()

      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email,
        password: finalPassword,
        email_confirm: true
      })
      if (createError || !created.user) {
        return json({ error: createError?.message || 'Failed to create account' }, 400)
      }

      const { error: profileError } = await admin.from('profiles').insert({
        id: created.user.id,
        full_name,
        email,
        role: 'instructor'
      })
      if (profileError) {
        await admin.auth.admin.deleteUser(created.user.id)
        return json({ error: profileError.message }, 400)
      }

      const { error: instProfileError } = await admin.from('instructor_profiles').insert({
        user_id: created.user.id,
        department: department || 'Unknown',
        title: title || 'Instructor',
        max_hours_per_term: max_hours_per_term || 40
      })
      if (instProfileError) {
        await admin.auth.admin.deleteUser(created.user.id)
        return json({ error: instProfileError.message }, 400)
      }

      // Only echo the password back when we generated it (bulk import) — never
      // echo back a password the admin typed themselves.
      return json({ id: created.user.id, password: password ? undefined : finalPassword })
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
