import terms from './content/terms.md?raw'
import privacy from './content/privacy.md?raw'
import subprocessors from './content/subprocessors.md?raw'
import dpa from './content/dpa.md?raw'
import security from './content/security.md?raw'

// Bump this whenever the Terms of Service or Privacy Policy change in a way users must agree to
// again. Everyone who last accepted a different version is asked to accept the new one the next
// time they sign in (see authStore and TermsModal).
export const TERMS_VERSION = '2026-11-01'

// While 'draft', every legal page carries a banner saying it is not yet in effect. Change to
// 'final' only once a lawyer has reviewed the documents and the [BRACKETED] placeholders in
// src/legal/content/ have been filled in.
export const LEGAL_STATUS: 'draft' | 'final' = 'draft'

export type LegalDocId = 'terms' | 'privacy' | 'subprocessors' | 'dpa' | 'security'

export const LEGAL_DOCS: Record<LegalDocId, { title: string; body: string }> = {
  terms: { title: 'Terms of Service', body: terms },
  privacy: { title: 'Privacy Policy', body: privacy },
  subprocessors: { title: 'Subprocessors', body: subprocessors },
  dpa: { title: 'Data Processing Addendum', body: dpa },
  security: { title: 'Security overview', body: security }
}

export function isLegalDocId(value: string | undefined): value is LegalDocId {
  return value !== undefined && Object.prototype.hasOwnProperty.call(LEGAL_DOCS, value)
}
