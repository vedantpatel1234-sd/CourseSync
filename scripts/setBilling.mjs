// Turns command-line options into an update for organization_billing. Pure (no database access)
// so it can be tested; scripts/set-billing.mjs applies the result.

export const STATUSES = ['trial', 'active', 'past_due', 'suspended', 'canceled']

const DAY_MS = 24 * 60 * 60 * 1000

function parseLimit(name, value) {
  if (value === 'unlimited') return null
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be a whole number or "unlimited"`)
  return Number(value)
}

/**
 * @param opts raw string options from the command line (all optional)
 * @param now  injectable clock for tests
 * @returns the columns to change; throws on invalid input or when nothing was given
 */
export function buildBillingPatch(opts, now = new Date()) {
  const patch = {}

  if (opts.plan !== undefined) {
    if (!opts.plan.trim()) throw new Error('--plan cannot be empty')
    patch.plan = opts.plan.trim()
  }

  if (opts.status !== undefined) {
    if (!STATUSES.includes(opts.status)) throw new Error(`--status must be one of: ${STATUSES.join(', ')}`)
    patch.subscription_status = opts.status
  }

  if (opts['max-instructors'] !== undefined) {
    patch.max_instructors = parseLimit('--max-instructors', opts['max-instructors'])
  }

  if (opts['ai-limit'] !== undefined) {
    patch.ai_monthly_token_limit = parseLimit('--ai-limit', opts['ai-limit'])
  }

  if (opts.ai !== undefined) {
    if (opts.ai !== 'on' && opts.ai !== 'off') throw new Error('--ai must be "on" or "off"')
    patch.ai_enabled = opts.ai === 'on'
  }

  if (opts['trial-days'] !== undefined) {
    if (!/^\d+$/.test(opts['trial-days'])) throw new Error('--trial-days must be a whole number')
    patch.trial_ends_at = new Date(now.getTime() + Number(opts['trial-days']) * DAY_MS).toISOString()
  }

  const msaGiven = ['msa-version', 'msa-signed-at', 'msa-signed-by'].filter(k => opts[k] !== undefined)
  if (msaGiven.length > 0) {
    // A contract record is only meaningful whole: which version, when, and who signed.
    if (msaGiven.length !== 3) {
      throw new Error('--msa-version, --msa-signed-at and --msa-signed-by must be given together')
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(opts['msa-signed-at']) || Number.isNaN(Date.parse(opts['msa-signed-at']))) {
      throw new Error('--msa-signed-at must be a date like 2026-11-02')
    }
    patch.msa_version = opts['msa-version']
    patch.msa_signed_at = new Date(`${opts['msa-signed-at']}T00:00:00Z`).toISOString()
    patch.msa_signed_by = opts['msa-signed-by']
  }

  if (Object.keys(patch).length === 0) {
    throw new Error('Nothing to change. Give at least one of: --plan --status --max-instructors --ai-limit --ai --trial-days --msa-*')
  }
  return patch
}
