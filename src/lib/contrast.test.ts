import { describe, it, expect } from 'vitest'
import { contrastRatio, AA_TEXT, AA_LARGE_OR_GRAPHIC } from './contrast'

describe('contrastRatio', () => {
  it('matches the published WCAG reference values', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 1)
    expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5)
    expect(contrastRatio('#777777', '#FFFFFF')).toBeCloseTo(4.48, 1) // the well-known just-failing grey
    expect(contrastRatio('#767676', '#FFFFFF')).toBeGreaterThanOrEqual(AA_TEXT) // and the just-passing one
  })

  it('is symmetric and accepts three-digit hex', () => {
    expect(contrastRatio('#123456', '#FFFFFF')).toBeCloseTo(contrastRatio('#FFFFFF', '#123456'), 10)
    expect(contrastRatio('#fff', '#000')).toBeCloseTo(21, 1)
  })

  it('rejects things that are not hex colours', () => {
    expect(() => contrastRatio('red', '#FFFFFF')).toThrow()
  })
})

// The app's colours are written inline in components, so a test that renders pages cannot see them
// (jsdom has no layout, and axe's contrast rule needs it). Instead, read the source: for every
// `color: '#hex'` find the background set in the same style object, or white if there is none,
// and check the pair.
const sources = import.meta.glob('/src/**/*.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

interface Pair { file: string; line: number; foreground: string; background: string; ratio: number }

function colourPairs(): Pair[] {
  const pairs: Pair[] = []
  for (const [file, source] of Object.entries(sources)) {
    if (file.endsWith('.test.tsx')) continue
    for (const m of source.matchAll(/(?<![-\w])color:\s*(?:'(#[0-9A-Fa-f]{6})'|'(white)')/g)) {
      const start = m.index ?? 0
      const foreground = (m[1] ?? '#FFFFFF').toUpperCase()
      const block = source.slice(source.lastIndexOf('{', start), source.indexOf('}', start + m[0].length))
      const gradient = block.match(/background:\s*[^,\n]*'linear-gradient\(135deg, (#[0-9A-Fa-f]{6})/)
      const flat = block.match(/background(?:Color)?:\s*(?:[^'\n]*?)?'(#[0-9A-Fa-f]{6})'/)
      const background = (gradient?.[1] ?? flat?.[1] ?? '#FFFFFF').toUpperCase()
      pairs.push({
        file, line: source.slice(0, start).split('\n').length, foreground, background,
        ratio: contrastRatio(foreground, background)
      })
    }
  }
  return pairs
}

// Disabled controls are exempt from WCAG contrast requirements (1.4.3). Each entry needs a reason.
const EXEMPT = new Map<string, string>([
  ['#FFFFFF on #A09AD4', 'white label on the lighter button shown while a request is in flight (button is disabled)']
])

describe('colours used in the app', () => {
  const pairs = colourPairs()

  it('finds the colours (guards against this test silently checking nothing)', () => {
    expect(pairs.length).toBeGreaterThan(200)
  })

  it('every text colour meets WCAG AA (4.5:1) on its background', () => {
    const failing = pairs
      .filter(p => p.ratio < AA_TEXT && !EXEMPT.has(`${p.foreground} on ${p.background}`))
      .map(p => `${p.file}:${p.line} ${p.foreground} on ${p.background} is ${p.ratio.toFixed(2)}:1`)
    expect([...new Set(failing)]).toEqual([])
  })

  it('the exemptions are still needed (remove them once nothing uses them)', () => {
    for (const key of EXEMPT.keys()) {
      expect(pairs.some(p => `${p.foreground} on ${p.background}` === key), key).toBe(true)
    }
  })

  it('the grey used for secondary text and icons passes on every surface it appears on', () => {
    for (const surface of ['#FFFFFF', '#F4F3F0', '#EEEDFE']) {
      expect(contrastRatio('#6B6B80', surface), surface).toBeGreaterThanOrEqual(AA_TEXT)
      expect(contrastRatio('#6B6B80', surface), surface).toBeGreaterThanOrEqual(AA_LARGE_OR_GRAPHIC)
    }
  })
})
