import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HatuaProvider } from '../theme/HatuaProvider'
import { ConfirmDialog } from './ConfirmDialog'
import { Toast } from './Toast'

/**
 * ADR-0002's last consequence: an overlay portalled to document.body escapes
 * the element carrying the custom properties and renders unthemed. These are
 * the first two components to portal anything, so the assertion is about WHERE
 * the node lands, not merely that it rendered.
 */
const themedRootOf = (node: Element | null) => node?.closest('.hatua-root') ?? null

describe('Toast', () => {
  it('lands inside the provider subtree, not on document.body', async () => {
    const { container } = render(
      <HatuaProvider>
        <Toast open>Draft published</Toast>
      </HatuaProvider>,
    )
    const toast = await screen.findByRole('status')
    expect(themedRootOf(toast)).not.toBeNull()
    expect(container.contains(toast)).toBe(true)
    expect(toast.closest('.hatua-portals')).not.toBeNull()
  })

  it('renders nothing when closed', () => {
    render(
      <HatuaProvider>
        <Toast open={false}>Draft published</Toast>
      </HatuaProvider>,
    )
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('renders nothing outside a provider, rather than falling back to the body', () => {
    render(<Toast open>Draft published</Toast>)
    expect(screen.queryByRole('status')).toBeNull()
    expect(document.body.querySelector('[role="status"]')).toBeNull()
  })

  it('omits the dismiss control when no handler was given', async () => {
    render(
      <HatuaProvider>
        <Toast open>Draft published</Toast>
      </HatuaProvider>,
    )
    await screen.findByRole('status')
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull()
  })
})

describe('Toast auto-dismiss', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  const renderTimed = (onDismiss: () => void, seconds = 4) =>
    render(
      <HatuaProvider>
        <Toast open autoDismissAfter={seconds} onDismiss={onDismiss}>
          Draft published
        </Toast>
      </HatuaProvider>,
    )

  const advance = async (ms: number) => {
    await act(async () => {
      vi.advanceTimersByTime(ms)
    })
  }

  it('asks to be closed once the seconds are up, and not before', async () => {
    const onDismiss = vi.fn()
    renderTimed(onDismiss)
    await advance(3900)
    expect(onDismiss).not.toHaveBeenCalled()
    await advance(200)
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('counts seconds, not milliseconds', async () => {
    const onDismiss = vi.fn()
    renderTimed(onDismiss, 2)
    await advance(1999)
    expect(onDismiss).not.toHaveBeenCalled()
    await advance(2)
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('shows a progress bar carrying the same duration the timer uses', () => {
    renderTimed(vi.fn(), 6)
    expect(screen.getByTestId('hatua-toast-progress').style.animationDuration).toBe('6s')
  })

  it('renders no progress bar when the toast is not timed', () => {
    render(
      <HatuaProvider>
        <Toast open onDismiss={vi.fn()}>
          Draft published
        </Toast>
      </HatuaProvider>,
    )
    expect(screen.queryByTestId('hatua-toast-progress')).toBeNull()
  })

  // A message that expires while it is being read, or while the pointer is on
  // its way to the dismiss button, is worse than one that never expires.
  it('pauses while the pointer is inside, and resumes on the way out', async () => {
    const onDismiss = vi.fn()
    renderTimed(onDismiss)
    await advance(1000)

    // React synthesises onMouseEnter/onMouseLeave from mouseover/mouseout.
    fireEvent.mouseOver(screen.getByRole('status'))
    await advance(60_000)
    expect(onDismiss).not.toHaveBeenCalled()
    expect(screen.getByRole('status').getAttribute('data-paused')).toBe('true')

    fireEvent.mouseOut(screen.getByRole('status'))
    expect(screen.getByRole('status').hasAttribute('data-paused')).toBe(false)

    // Resuming continues the wait rather than restarting it: 1s was already
    // spent before the pause, so 3s is what remains of the 4.
    await advance(2900)
    expect(onDismiss).not.toHaveBeenCalled()
    await advance(200)
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('pauses while focus is inside, so keyboard users are not rushed', async () => {
    const onDismiss = vi.fn()
    renderTimed(onDismiss)
    fireEvent.focus(screen.getByRole('button', { name: 'Dismiss' }))
    await advance(60_000)
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('drops the timer when it closes, and gives a reopened toast the full wait', async () => {
    const onDismiss = vi.fn()
    const at = (open: boolean) => (
      <HatuaProvider>
        <Toast open={open} autoDismissAfter={4} onDismiss={onDismiss}>
          Draft published
        </Toast>
      </HatuaProvider>
    )
    const { rerender } = render(at(true))

    await advance(3000)
    rerender(at(false))
    await advance(60_000)
    expect(onDismiss).not.toHaveBeenCalled()

    // Reopened: the 3s already spent must not carry over, or this would fire
    // almost immediately.
    rerender(at(true))
    await advance(3900)
    expect(onDismiss).not.toHaveBeenCalled()
    await advance(200)
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('ignores the duration when there is no handler to call', async () => {
    render(
      <HatuaProvider>
        <Toast open autoDismissAfter={1}>
          Draft published
        </Toast>
      </HatuaProvider>,
    )
    await advance(60_000)
    expect(screen.queryByTestId('hatua-toast-progress')).toBeNull()
    expect(screen.getByRole('status')).toBeDefined()
  })
})

describe('ConfirmDialog', () => {
  const props = {
    open: true,
    title: 'Discard this Draft?',
    description: 'Its version number goes back into the pool.',
    onConfirm: () => {},
    onCancel: () => {},
  }

  it('lands inside the provider subtree, not on document.body', async () => {
    const { container } = render(
      <HatuaProvider>
        <ConfirmDialog {...props} />
      </HatuaProvider>,
    )
    const dialog = await screen.findByRole('dialog')
    expect(themedRootOf(dialog)).not.toBeNull()
    expect(container.contains(dialog)).toBe(true)
    expect(dialog.closest('.hatua-portals')).not.toBeNull()
  })

  it('names and describes itself from the content it was given', async () => {
    render(
      <HatuaProvider>
        <ConfirmDialog {...props} />
      </HatuaProvider>,
    )
    const dialog = await screen.findByRole('dialog', { name: 'Discard this Draft?' })
    const describedBy = dialog.getAttribute('aria-describedby')
    expect(dialog.querySelector(`#${describedBy}`)?.textContent).toContain('version number')
  })

  it('focuses the confirm action on open', async () => {
    render(
      <HatuaProvider>
        <ConfirmDialog {...props} confirmLabel="Discard" />
      </HatuaProvider>,
    )
    expect(await screen.findByRole('button', { name: 'Discard' })).toBe(document.activeElement)
  })

  it('cancels on Escape, wherever focus happens to be', async () => {
    const onCancel = vi.fn()
    render(
      <HatuaProvider>
        <ConfirmDialog {...props} onCancel={onCancel} />
      </HatuaProvider>,
    )
    await screen.findByRole('dialog')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('stops listening for Escape once closed', async () => {
    const onCancel = vi.fn()
    const { rerender } = render(
      <HatuaProvider>
        <ConfirmDialog {...props} onCancel={onCancel} />
      </HatuaProvider>,
    )
    await screen.findByRole('dialog')
    rerender(
      <HatuaProvider>
        <ConfirmDialog {...props} open={false} onCancel={onCancel} />
      </HatuaProvider>,
    )
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(onCancel).not.toHaveBeenCalled()
  })
})
