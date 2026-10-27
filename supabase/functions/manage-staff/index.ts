// Invites and removes administrator and coordinator accounts for the caller's own organization.
// Instructors are handled by manage-instructor. Like that function, this one uses the service-role
// key (which bypasses row-level security), so it enforces the tenant boundary itself: the
// organization always comes from the caller's own profile, never from the request, and only
// administrators may call it. The decision rules live in ../_shared/staff.ts and are unit-tested.
//
// New people are invited by email and choose their own password; no administrator ever sees one.
//
// Requires migrations 010-014. Deploy with: supabase functions deploy manage-staff --no-verify-jwt
// (SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are injected automatically.)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { checkCanAddStaff, checkCanRemoveStaff, validateStaffInvite, STAFF_ROLES } from '../_shared/staff.ts'

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

// Supabase redirects the invitation link here; Supabase itself only honours URLs on the project's
// Redirect URL allow-list.
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

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } }
    })
    const { data: { user: caller }, error: callerError } = await callerClient.auth.getUser()
    if (callerError || !caller) return json({ error: 'Not authenticated' }, 401)

    const admin = createClient(supabaseUrl, serviceRoleKey)

    const { data: callerProfile } = await admin
      .from('profiles')
      .select('role, organization_id')
      .eq('id', caller.id)
      .single()

    if (callerProfile?.role !== 'admin') {
      return json({ error: 'Only administrators can manage administrator and coordinator accounts' }, 403)
    }
    const organizationId: string = callerProfile.organization_id

    const body = await req.json()

    if (body.action === 'invite') {
      const parsed = validateStaffInvite(body)
      if (!parsed.ok) return json({ error: parsed.error, code: parsed.code }, parsed.status)
      const { full_name, email, role } = parsed.invite

      // Fails closed if the billing row can't be read (migration 012).
      const { data: billing } = await admin
        .from('organization_billing')
        .select('subscription_status, trial_ends_at, max_instructors, ai_enabled, ai_monthly_token_limit')
        .eq('organization_id', organizationId)
        .single()
      if (!billing) {
        return json({ error: 'Billing is not set up for this organization. Contact us.', code: 'billing_unavailable' }, 403)
      }

      const { count: staffCount, error: countError } = await admin
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', organizationId)
        .in('role', [...STAFF_ROLES])
      if (countError) return json({ error: 'Could not check your account limits. Try again shortly.' }, 500)

      const allowed = checkCanAddStaff(billing, staffCount ?? 0)
      if (!allowed.ok) return json({ error: allowed.error, code: allowed.code }, allowed.status)

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
        role,
        organization_id: organizationId
      })
      if (profileError) {
        await admin.auth.admin.deleteUser(invited.user.id)
        return json({ error: profileError.message }, 400)
      }

      return json({ id: invited.user.id })
    }

    if (body.action === 'remove') {
      const targetId = body.user_id
      if (typeof targetId !== 'string' || !targetId) return json({ error: 'user_id is required' }, 400)

      const { data: target } = await admin
        .from('profiles')
        .select('id, role, organization_id')
        .eq('id', targetId)
        .maybeSingle()

      const allowed = checkCanRemoveStaff(caller.id, organizationId, target)
      if (!allowed.ok) return json({ error: allowed.error, code: allowed.code }, allowed.status)

      // Drafts belong to the school's work, not to the person who happened to create them. Hand
      // them to the administrator doing the removal instead of letting them be deleted with the
      // account.
      const { error: reassignError } = await admin
        .from('drafts')
        .update({ created_by: caller.id })
        .eq('created_by', targetId)
        .eq('organization_id', organizationId)
      if (reassignError) {
        return json({ error: `Could not hand over this person's drafts: ${reassignError.message}` }, 500)
      }

      // Removes the profile and anything keyed to it, scrubs their name and email from activity
      // records and weekly digests, and refuses to remove the organization's only administrator
      // (migration 014).
      const { error: eraseError } = await admin.rpc('erase_person_data', { p_user: targetId })
      if (eraseError) return json({ error: eraseError.message }, 400)

      const { error: deleteError } = await admin.auth.admin.deleteUser(targetId)
      if (deleteError) {
        return json({ error: `Account data removed, but the login could not be deleted: ${deleteError.message}` })
      }

      return json({ success: true })
    }

    return json({ error: `Unknown action: ${body.action}` }, 400)
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Unexpected error' }, 500)
  }
})
