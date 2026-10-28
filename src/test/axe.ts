import axe from 'axe-core'

// Runs the axe accessibility engine against rendered DOM and returns a readable list of problems.
//
// jsdom has no layout engine, so rules that need real rendering cannot work here. The two that
// matter are colour contrast (checked separately, from the palette, in src/lib/contrast.test.ts)
// and anything that depends on element size or position. Everything else (names, roles, labels,
// landmarks, headings, ARIA validity, duplicate ids, language) runs for real.
const WCAG_AA_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']

const CONTROLS = 'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]), select, textarea'

function describe(el: Element): string {
  const attrs = ['type', 'placeholder', 'name', 'id'].map(a => (el.getAttribute(a) ? `${a}="${el.getAttribute(a)}"` : '')).filter(Boolean)
  return `<${el.tagName.toLowerCase()} ${attrs.join(' ')}>`.replace(' >', '>')
}

/**
 * axe accepts a placeholder as a form control's name, which hides the common mistake of drawing a
 * visible label that is not actually connected to its field: a screen reader then announces the
 * placeholder ("jane@college.ca") instead of the field name ("Email"), and the placeholder is gone
 * as soon as the user types. This is the stricter rule: a real label, aria-label or aria-labelledby.
 */
export function labelProblems(root: ParentNode = document.body): string[] {
  const problems: string[] = []

  for (const control of root.querySelectorAll<HTMLInputElement>(CONTROLS)) {
    if (control.closest('[hidden], [aria-hidden="true"]') || getComputedStyle(control).display === 'none') continue
    const named = (control.labels?.length ?? 0) > 0 ||
      control.hasAttribute('aria-label') || control.hasAttribute('aria-labelledby')
    if (!named) problems.push(`no label: ${describe(control)}`)
  }

  for (const label of root.querySelectorAll<HTMLLabelElement>('label')) {
    if (!label.control) problems.push(`label "${(label.textContent ?? '').trim().slice(0, 40)}" is not connected to any field`)
  }
  return problems
}

export async function accessibilityViolations(root: Element = document.body): Promise<string[]> {
  const results = await axe.run(root, {
    runOnly: { type: 'tag', values: WCAG_AA_TAGS },
    rules: {
      'color-contrast': { enabled: false },
      // A page rendered on its own in a test has no surrounding document to hold these.
      'landmark-one-main': { enabled: false },
      'page-has-heading-one': { enabled: false },
      region: { enabled: false }
    }
  })
  const fromAxe = results.violations.map(v => {
    const where = v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' | ')
    return `${v.id} (${v.impact}): ${v.help} — ${v.nodes.length} element(s), e.g. ${where}`
  })
  return [...fromAxe, ...labelProblems(root)]
}
