// @vitest-environment node
import { describe, it, expect } from 'vitest'
import {
  validateStaffInvite, checkCanAddStaff, checkCanRemoveStaff, MAX_STAFF_ACCOUNTS, STAFF_ROLES
} from '../../supabase/functions/_shared/staff'
import type { BillingRow } from '../../supabase/functions/_shared/entitlements'

const billing = (over: Partial<BillingRow> = {}): BillingRow => ({
  subscription_status: 'active', trial_ends_at: null, max_instructors: 25, ai_enabled: true,
  ai_monthly_token_limit: 1_000_000, ...over
})

describe('validateStaffInvite', () => {
  const valid = { full_name: 'Dana Lee', email: 'dana@fvc.example', role: 'coordinator' }

  it('accepts an administrator or a coordinator', () => {
    for (const role of STAFF_ROLES) {
      expect(validateStaffInvite({ ...valid, role })).toEqual({ ok: true, invite: { ...valid, role } })
    }
  })

  it('tidies the input: trims the name and lower-cases the email', () => {
    expect(validateStaffInvite({ full_name: '  Dana Lee  ', email: '  Dana@FVC.Example ', role: 'admin' }))
      .toEqual({ ok: true, invite: { full_name: 'Dana Lee', email: 'dana@fvc.example', role: 'admin' } })
  })

  it('refuses to invite anyone as an instructor or any other role through this route', () => {
    for (const role of ['instructor', 'owner', 'superadmin', '', undefined, null, 5]) {
      expect(validateStaffInvite({ ...valid, role })).toMatchObject({ ok: false, status: 400, code: 'invalid_role' })
    }
  })

  it.each([undefined, '', 'D', ' ', 'x'.repeat(101), 42])('rejects the name %j', name => {
    expect(validateStaffInvite({ ...valid, full_name: name })).toMatchObject({ ok: false, code: 'invalid_name' })
  })

  it.each([undefined, '', 'nope', 'a@b', '@x.com', 'a b@x.com', 'a@x.com\nb@y.com', `${'a'.repeat(250)}@x.com`])(
    'rejects the email %j', email => {
      expect(validateStaffInvite({ ...valid, email })).toMatchObject({ ok: false, code: 'invalid_email' })
    })

  it('rejects a body that is not an object', () => {
    expect(validateStaffInvite(undefined)).toMatchObject({ ok: false })
    expect(validateStaffInvite(null)).toMatchObject({ ok: false })
    expect(validateStaffInvite('admin')).toMatchObject({ ok: false })
  })
})

describe('checkCanAddStaff', () => {
  it('allows an invitation while under the limit', () => {
    expect(checkCanAddStaff(billing(), MAX_STAFF_ACCOUNTS - 1)).toEqual({ ok: true })
  })

  it('blocks at the limit and says what the limit is', () => {
    const result = checkCanAddStaff(billing(), MAX_STAFF_ACCOUNTS)
    expect(result).toMatchObject({ ok: false, status: 402, code: 'staff_limit' })
    expect(result.ok === false && result.error).toContain(String(MAX_STAFF_ACCOUNTS))
  })

  it('blocks a suspended, canceled or expired-trial organization before looking at the count', () => {
    expect(checkCanAddStaff(billing({ subscription_status: 'suspended' }), 0)).toMatchObject({ ok: false, code: 'suspended' })
    expect(checkCanAddStaff(billing({ subscription_status: 'canceled' }), 0)).toMatchObject({ ok: false, code: 'canceled' })
    expect(checkCanAddStaff(
      billing({ subscription_status: 'trial', trial_ends_at: '2020-01-01T00:00:00Z' }), 0
    )).toMatchObject({ ok: false, code: 'trial_expired' })
  })

  it('still allows an overdue (past_due) organization, which is a grace period', () => {
    expect(checkCanAddStaff(billing({ subscription_status: 'past_due' }), 1)).toEqual({ ok: true })
  })
})

describe('checkCanRemoveStaff', () => {
  const ORG = 'org-1'
  const target = (over: Record<string, string> = {}) => ({ id: 'u2', role: 'coordinator', organization_id: ORG, ...over })

  it('lets an administrator remove another administrator or a coordinator in their organization', () => {
    expect(checkCanRemoveStaff('u1', ORG, target({ role: 'coordinator' }))).toEqual({ ok: true })
    expect(checkCanRemoveStaff('u1', ORG, target({ role: 'admin' }))).toEqual({ ok: true })
  })

  it('does not let someone remove their own account', () => {
    expect(checkCanRemoveStaff('u1', ORG, target({ id: 'u1' }))).toMatchObject({ ok: false, code: 'cannot_remove_self' })
  })

  it('treats an account in another organization exactly like one that does not exist', () => {
    const elsewhere = checkCanRemoveStaff('u1', ORG, target({ organization_id: 'org-2' }))
    const missing = checkCanRemoveStaff('u1', ORG, null)
    expect(elsewhere).toEqual(missing)
    expect(elsewhere).toMatchObject({ ok: false, status: 404, code: 'not_found' })
  })

  it('does not let this route remove an instructor (they have their own screen and rules)', () => {
    expect(checkCanRemoveStaff('u1', ORG, target({ role: 'instructor' }))).toMatchObject({ ok: false, code: 'not_found' })
  })

  it('refuses an unknown role rather than assuming it is staff', () => {
    expect(checkCanRemoveStaff('u1', ORG, target({ role: 'owner' }))).toMatchObject({ ok: false, code: 'not_found' })
  })
})
