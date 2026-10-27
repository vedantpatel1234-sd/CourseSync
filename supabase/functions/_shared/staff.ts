// Pure rules for administrator and coordinator accounts, shared by the manage-staff Edge Function
// (Deno) and the test suite (Node). No I/O. Instructors have their own flow (manage-instructor).

import { checkStanding } from './entitlements.ts'
import type { BillingRow, Decision, Denial } from './entitlements.ts'

export const STAFF_ROLES = ['admin', 'coordinator'] as const
export type StaffRole = typeof STAFF_ROLES[number]

// A safety rail, not a pricing tier: it stops a mistaken or compromised admin account from
// sending unlimited invitation emails. Raise it here if a large school genuinely needs more.
export const MAX_STAFF_ACCOUNTS = 25

const deny = (status: number, code: string, error: string): Denial => ({ ok: false, status, code, error })

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export interface StaffInvite {
  full_name: string
  email: string
  role: StaffRole
}

/** Checks and tidies an invitation request. Email is lower-cased and names are trimmed. */
export function validateStaffInvite(body: unknown): { ok: true; invite: StaffInvite } | Denial {
  const b = (body ?? {}) as Record<string, unknown>
  const full_name = typeof b.full_name === 'string' ? b.full_name.trim() : ''
  const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : ''

  if (full_name.length < 2 || full_name.length > 100) {
    return deny(400, 'invalid_name', 'Enter the person\'s full name (2 to 100 characters).')
  }
  if (!EMAIL.test(email) || email.length > 254) {
    return deny(400, 'invalid_email', 'Enter a valid email address.')
  }
  if (!(STAFF_ROLES as readonly unknown[]).includes(b.role)) {
    return deny(400, 'invalid_role', 'Choose Administrator or Coordinator.')
  }
  return { ok: true, invite: { full_name, email, role: b.role as StaffRole } }
}

/** May another administrator or coordinator be invited? */
export function checkCanAddStaff(billing: BillingRow, currentStaff: number, now: Date = new Date()): Decision {
  const standing = checkStanding(billing, now)
  if (!standing.ok) return standing
  if (currentStaff >= MAX_STAFF_ACCOUNTS) {
    return deny(
      402, 'staff_limit',
      `You already have ${MAX_STAFF_ACCOUNTS} administrator and coordinator accounts, which is the limit. Remove one or contact us.`
    )
  }
  return { ok: true }
}

export interface RemovalTarget {
  id: string
  role: string
  organization_id: string
}

/**
 * May the caller remove this account? The target must be a staff member of the caller's own
 * organization, and never the caller themselves (so nobody locks themselves out by accident).
 * Removing the last administrator is additionally refused by the database.
 */
export function checkCanRemoveStaff(
  callerId: string,
  callerOrganizationId: string,
  target: RemovalTarget | null
): Decision {
  // A missing account and one in another organization look identical, on purpose: do not
  // reveal that an id exists elsewhere.
  if (!target || target.organization_id !== callerOrganizationId || !(STAFF_ROLES as readonly string[]).includes(target.role)) {
    return deny(404, 'not_found', 'That account was not found.')
  }
  if (target.id === callerId) {
    return deny(400, 'cannot_remove_self', 'You can\'t remove your own account. Ask another administrator to do it.')
  }
  return { ok: true }
}
