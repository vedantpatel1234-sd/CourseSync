import { useEffect, useRef } from 'react'

// Behaviour every modal dialog needs and a plain <div> does not give you (WCAG 2.1.2, 2.4.3):
//  - keyboard focus moves into the dialog when it opens, and returns to where it was when it closes
//  - Tab and Shift+Tab cycle inside the dialog instead of wandering into the page behind it
//  - Escape closes it, when closing is allowed
//
// Usage: put the returned ref on the dialog panel, together with role="dialog" (or "alertdialog"),
// aria-modal="true" and aria-labelledby pointing at its heading. Mark the control that should get
// focus first with data-autofocus; otherwise the first focusable element does.

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',')

interface DialogOptions {
  /** Called on Escape. Leave out for a dialog that must be answered (for example accepting terms). */
  onClose?: () => void
  /** For a dialog that stays mounted while hidden. Defaults to true: active for as long as it is mounted. */
  active?: boolean
}

export function useDialog<T extends HTMLElement = HTMLDivElement>({ onClose, active = true }: DialogOptions = {}) {
  const ref = useRef<T>(null)
  const onCloseRef = useRef(onClose)

  useEffect(() => { onCloseRef.current = onClose }, [onClose])

  useEffect(() => {
    const dialog = ref.current
    if (!active || !dialog) return
    const previouslyFocused = document.activeElement as HTMLElement | null

    const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE))

    // The panel itself is focusable as a last resort, so focus never stays behind the dialog.
    if (!dialog.hasAttribute('tabindex')) dialog.tabIndex = -1
    const items = focusable()
    ;(items.find(el => el.hasAttribute('data-autofocus')) ?? items[0] ?? dialog).focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && onCloseRef.current) {
        event.stopPropagation()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab') return

      const tabbable = focusable()
      if (tabbable.length === 0) { event.preventDefault(); dialog.focus(); return }
      const first = tabbable[0]
      const last = tabbable[tabbable.length - 1]
      const active = document.activeElement
      const outside = !dialog.contains(active)
      if (event.shiftKey && (active === first || active === dialog || outside)) {
        event.preventDefault(); last.focus()
      } else if (!event.shiftKey && (active === last || outside)) {
        event.preventDefault(); first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      // Skip if the thing that opened the dialog has since left the page.
      if (previouslyFocused && document.contains(previouslyFocused)) previouslyFocused.focus()
    }
  }, [active])

  return ref
}
