import { describe, it, expect } from 'vitest'
import { LEGAL_DOCS, LEGAL_STATUS, TERMS_VERSION, isLegalDocId } from './index'
import type { LegalDocId } from './index'

const IDS = Object.keys(LEGAL_DOCS) as LegalDocId[]

// Anything in [square brackets] that is not a markdown link, i.e. a placeholder or a note
// still waiting for a decision or verification.
const PLACEHOLDER = /\[[^\]]*\](?!\()/g

describe('legal documents', () => {
  it.each(IDS)('%s has content and starts with a heading', id => {
    const { title, body } = LEGAL_DOCS[id]
    expect(title.length).toBeGreaterThan(0)
    expect(body.trim().startsWith('# ')).toBe(true)
    expect(body.length).toBeGreaterThan(500)
  })

  it('every in-app link between documents points at a document that exists', () => {
    for (const id of IDS) {
      for (const match of LEGAL_DOCS[id].body.matchAll(/\]\((\/legal\/([a-z]+))\)/g)) {
        expect(isLegalDocId(match[2]), `${id} links to ${match[1]}`).toBe(true)
      }
    }
  })

  it('has a dated version for the acceptance record', () => {
    expect(TERMS_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('cannot be marked final while placeholders or [VERIFY] notes remain', () => {
    // Flipping LEGAL_STATUS to "final" is the "a lawyer has reviewed this" switch. It must not
    // be possible to do that with unfilled placeholders still in the published text.
    if (LEGAL_STATUS !== 'final') return
    for (const id of IDS) {
      const left = LEGAL_DOCS[id].body.match(PLACEHOLDER) ?? []
      expect(left, `${id} still has placeholders`).toEqual([])
    }
  })

  it('the placeholder detector itself recognises what we use', () => {
    expect('see [COMPANY LEGAL NAME] and [30] days, **[VERIFY]**'.match(PLACEHOLDER)).toHaveLength(3)
    expect('read the [Privacy Policy](/legal/privacy)'.match(PLACEHOLDER)).toBeNull()
  })
})

describe('isLegalDocId', () => {
  it('accepts known documents only', () => {
    expect(isLegalDocId('terms')).toBe(true)
    expect(isLegalDocId('dpa')).toBe(true)
    expect(isLegalDocId('nope')).toBe(false)
    expect(isLegalDocId(undefined)).toBe(false)
    expect(isLegalDocId('constructor')).toBe(false) // not an inherited property
  })
})
