import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useDialog } from './useDialog'

function Harness({ onClose, autofocus = false }: { onClose?: () => void; autofocus?: boolean }) {
  const [open, setOpen] = useState(false)
  const ref = useDialog({ active: open, onClose: onClose ? () => { onClose(); setOpen(false) } : undefined })
  return (
    <div>
      <button onClick={() => setOpen(true)}>Open</button>
      <button>Behind the dialog</button>
      {open && (
        <div ref={ref} role="dialog" aria-modal="true" aria-label="Example">
          <button>First</button>
          <button data-autofocus={autofocus ? '' : undefined}>Middle</button>
          <button>Last</button>
          <button disabled>Disabled</button>
        </div>
      )}
    </div>
  )
}

async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByText('Open'))
}

describe('useDialog', () => {
  it('moves focus into the dialog when it opens', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await openDialog(user)
    expect(screen.getByText('First')).toHaveFocus()
  })

  it('focuses the element marked data-autofocus instead of the first one', async () => {
    const user = userEvent.setup()
    render(<Harness autofocus />)
    await openDialog(user)
    expect(screen.getByText('Middle')).toHaveFocus()
  })

  it('keeps Tab inside the dialog, wrapping from last to first and skipping disabled controls', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await openDialog(user)
    await user.tab(); await user.tab()
    expect(screen.getByText('Last')).toHaveFocus()
    await user.tab()
    expect(screen.getByText('First')).toHaveFocus()
    expect(screen.getByText('Behind the dialog')).not.toHaveFocus()
  })

  it('keeps Shift+Tab inside the dialog, wrapping from first to last', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await openDialog(user)
    await user.tab({ shift: true })
    expect(screen.getByText('Last')).toHaveFocus()
  })

  it('closes on Escape when closing is allowed, and gives focus back to what opened it', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<Harness onClose={onClose} />)
    await openDialog(user)
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByText('Open')).toHaveFocus()
  })

  it('ignores Escape for a dialog that must be answered (no onClose)', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await openDialog(user)
    await user.keyboard('{Escape}')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('does nothing while inactive', () => {
    render(<Harness />)
    expect(document.body).toHaveFocus()
  })
})
