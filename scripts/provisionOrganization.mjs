// Creates an organization and invites its first admin. Used by scripts/provision-org.mjs;
// kept separate (with the Supabase client passed in) so the rollback paths can be tested.
//
// Runs with the service-role key, so it bypasses row-level security: it must only ever be run
// by the vendor, from a trusted machine.

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,40}$/
const EMAIL_PATTERN = /^\S+@\S+\.\S+$/

export async function provisionOrganization(supabase, { name, slug, adminEmail, adminName, redirectTo }) {
  if (!name?.trim()) throw new Error('Organization name is required')
  if (!SLUG_PATTERN.test(slug ?? '')) {
    throw new Error('Slug must be 2-41 characters: lowercase letters, numbers and hyphens, starting with a letter or number')
  }
  if (!EMAIL_PATTERN.test(adminEmail ?? '')) throw new Error('A valid admin email is required')
  if (!adminName?.trim()) throw new Error('Admin name is required')

  const { data: org, error: orgError } = await supabase
    .from('organizations')
    .insert({ name: name.trim(), slug })
    .select('id')
    .single()
  if (orgError) throw new Error(`Could not create organization: ${orgError.message}`)

  // Undo whatever was created so far, so a failed run leaves nothing half-provisioned.
  const rollback = async (userId) => {
    if (userId) await supabase.auth.admin.deleteUser(userId)
    await supabase.from('organizations').delete().eq('id', org.id)
  }

  const { data: invited, error: inviteError } = await supabase.auth.admin.inviteUserByEmail(adminEmail, { redirectTo })
  if (inviteError || !invited?.user) {
    await rollback(null)
    throw new Error(`Could not invite the admin: ${inviteError?.message ?? 'no user returned'}`)
  }

  const { error: profileError } = await supabase.from('profiles').insert({
    id: invited.user.id,
    full_name: adminName.trim(),
    email: adminEmail,
    role: 'admin',
    organization_id: org.id
  })
  if (profileError) {
    await rollback(invited.user.id)
    throw new Error(`Could not create the admin profile: ${profileError.message}`)
  }

  return { organizationId: org.id, adminId: invited.user.id }
}
