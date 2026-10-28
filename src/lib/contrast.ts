// WCAG 2.x contrast ratio between two sRGB hex colours, from 1 (identical) to 21 (black on white).
// jsdom has no layout engine, so axe cannot measure contrast in the test suite; this lets the
// palette be checked directly instead (see contrast.test.ts).

function channel(value: number): number {
  const c = value / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function luminance(hex: string): number {
  let h = hex.replace('#', '')
  if (h.length === 3) h = h.split('').map(c => c + c).join('')
  if (!/^[0-9a-fA-F]{6}$/.test(h)) throw new Error(`Not a hex colour: ${hex}`)
  const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16))
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

export function contrastRatio(foreground: string, background: string): number {
  const a = luminance(foreground)
  const b = luminance(background)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

/** WCAG AA: 4.5:1 for normal text, 3:1 for large text and for icons and other interface parts. */
export const AA_TEXT = 4.5
export const AA_LARGE_OR_GRAPHIC = 3
