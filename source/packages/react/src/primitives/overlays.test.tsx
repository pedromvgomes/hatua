import { act, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
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

/**
 * The visible card, as opposed to the live region that wraps it. The region is
 * mounted whether or not a toast is showing, so `getByRole('status')` is the
 * wrong handle for anything about the card.
 */
const toastCard = (text: string | RegExp = /Draft published/) =>
  screen.getByText(text).parentElement as HTMLElement

describe('Toast', () => {
  it('lands inside the provider subtree, not on document.body', async () => {
    const { container } = render(
      <HatuaProvider>
        <Toast open>Draft published</Toast>
      </HatuaProvider>,
    )
    await screen.findByText('Draft published')
    const card = toastCard()
    expect(themedRootOf(card)).not.toBeNull()
    expect(container.contains(card)).toBe(true)
    expect(card.closest('.hatua-portals')).not.toBeNull()
  })

  it('shows no toast when closed', async () => {
    render(
      <HatuaProvider>
        <Toast open={false}>Draft published</Toast>
      </HatuaProvider>,
    )
    await screen.findByRole('status')
    expect(screen.queryByText('Draft published')).toBeNull()
  })

  /*
   * Assistive technology announces a live region whose CONTENTS change. One
   * inserted with its text already in place is routinely missed — so the region
   * has to exist before there is anything to say, and the message has to arrive
   * into it. Mounting the two together is silent for screen reader users while
   * looking perfectly correct on screen, which is why this is a test and not a
   * comment.
   */
  it('keeps an empty live region mounted before there is anything to announce', async () => {
    render(
      <HatuaProvider>
        <Toast open={false}>Draft published</Toast>
      </HatuaProvider>,
    )
    const region = await screen.findByRole('status')
    expect(region.getAttribute('aria-live')).toBe('polite')
    expect(region.textContent).toBe('')
    expect(region.closest('.hatua-portals')).not.toBeNull()
  })

  it('renders nothing outside a provider, rather than falling back to the body', () => {
    render(<Toast open>Draft published</Toast>)
    expect(screen.queryByRole('status')).toBeNull()
    // biome-ignore lint/security/noSecrets: an attribute selector, not a credential.
    expect(document.body.querySelector('[role="status"]')).toBeNull()
  })

  it('omits the dismiss control when no handler was given', async () => {
    render(
      <HatuaProvider>
        <Toast open>Draft published</Toast>
      </HatuaProvider>,
    )
    await screen.findByText('Draft published')
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
    fireEvent.mouseOver(toastCard())
    await advance(60_000)
    expect(onDismiss).not.toHaveBeenCalled()
    expect(toastCard().getAttribute('data-paused')).toBe('true')

    fireEvent.mouseOut(toastCard())
    expect(toastCard().hasAttribute('data-paused')).toBe(false)

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

  /*
   * Hover and focus are two independent holds, not one shared flag. Sharing one
   * meant the pointer leaving cleared a pause that focus was still holding —
   * so a toast would dismiss itself out from under the button someone had just
   * tabbed to, taking their focus with it.
   */
  it('stays held by focus after the pointer leaves, and by the pointer after blur', async () => {
    const onDismiss = vi.fn()
    renderTimed(onDismiss)
    const dismiss = screen.getByRole('button', { name: 'Dismiss' })

    fireEvent.mouseOver(toastCard())
    fireEvent.focus(dismiss)
    fireEvent.mouseOut(toastCard())
    await advance(60_000)
    expect(onDismiss).not.toHaveBeenCalled()
    expect(toastCard().getAttribute('data-paused')).toBe('true')

    // The mirror case: focus leaves while the pointer is back inside.
    fireEvent.mouseOver(toastCard())
    fireEvent.blur(dismiss)
    await advance(60_000)
    expect(onDismiss).not.toHaveBeenCalled()

    // Only once both are gone does the countdown run out.
    fireEvent.mouseOut(toastCard())
    await advance(4100)
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  /*
   * The timer has to follow the duration, not just the bar. With onDismiss
   * stable — a useCallback, or a toast store — nothing else in the timer's
   * dependencies changes, so a duration change left the old setTimeout standing
   * while the bar re-rendered with the new one. The two then told the user
   * different things, which is exactly what the shared state exists to prevent.
   */
  it('reschedules when the duration changes under a stable handler', async () => {
    const onDismiss = vi.fn()
    const at = (seconds: number) => (
      <HatuaProvider>
        <Toast open autoDismissAfter={seconds} onDismiss={onDismiss}>
          Draft published
        </Toast>
      </HatuaProvider>
    )
    const { rerender } = render(at(4))

    await advance(1000)
    rerender(at(20))
    expect(screen.getByTestId('hatua-toast-progress').style.animationDuration).toBe('20s')

    // Well past the original 4s deadline, which must not have survived.
    await advance(3500)
    expect(onDismiss).not.toHaveBeenCalled()

    // The 1s already spent still counts, so 20s from opening is the deadline.
    await advance(15_600)
    expect(onDismiss).toHaveBeenCalledTimes(1)
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

  /*
   * The pause handlers are attached only while the toast is timed, so losing
   * the timer under the pointer means onMouseLeave is never wired up to observe
   * the pointer leaving. `hovered` would latch at true, and restoring the timer
   * without cycling `open` would leave a frozen bar on a toast that never
   * dismisses itself again.
   */
  it('does not latch paused when the timer is taken away under the pointer', async () => {
    const onDismiss = vi.fn()
    const { rerender } = render(
      <HatuaProvider>
        <Toast open autoDismissAfter={4} onDismiss={onDismiss}>
          Draft published
        </Toast>
      </HatuaProvider>,
    )
    fireEvent.mouseOver(toastCard())
    expect(toastCard().getAttribute('data-paused')).toBe('true')

    // The timer goes away while the pointer is still inside, and comes back.
    const untimed = (
      <HatuaProvider>
        <Toast open onDismiss={onDismiss}>
          Draft published
        </Toast>
      </HatuaProvider>
    )
    rerender(untimed)
    rerender(
      <HatuaProvider>
        <Toast open autoDismissAfter={4} onDismiss={onDismiss}>
          Draft published
        </Toast>
      </HatuaProvider>,
    )
    expect(toastCard().getAttribute('data-paused')).toBeNull()
    await advance(4100)
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  /*
   * The toast is controlled, so a caller may leave it open after onDismiss —
   * and an inline closure gives the effect a new identity on every render. With
   * the wait already spent the remaining time collapses to zero, so without
   * treating expiry as terminal the toast asks again on every parent render.
   */
  it('asks to be closed once per showing, however often it re-renders', async () => {
    const onDismiss = vi.fn()
    const { rerender } = render(
      <HatuaProvider>
        <Toast open autoDismissAfter={4} onDismiss={() => onDismiss()}>
          Draft published
        </Toast>
      </HatuaProvider>,
    )
    await advance(4100)
    expect(onDismiss).toHaveBeenCalledTimes(1)

    // The caller ignored it. Three more renders, each with a fresh closure.
    for (let i = 0; i < 3; i++) {
      rerender(
        <HatuaProvider>
          <Toast open autoDismissAfter={4} onDismiss={() => onDismiss()}>
            Draft published
          </Toast>
        </HatuaProvider>,
      )
      await advance(50)
    }
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
    expect(screen.getByText('Draft published')).toBeDefined()
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

  /*
   * The exception, and the reason the dialog exists at all. A destructive
   * confirmation that opens on its own destructive action hands back the step
   * it was put there to add: the keystroke that opened the dialog is still
   * under the user's finger, and Enter lands on Discard. Focus the safe action
   * and the reflex costs nothing.
   */
  it('focuses cancel instead when the confirmation is destructive', async () => {
    render(
      <HatuaProvider>
        <ConfirmDialog {...props} tone="danger" confirmLabel="Discard" />
      </HatuaProvider>,
    )
    await screen.findByRole('dialog')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }))
    expect(document.activeElement).not.toBe(screen.getByRole('button', { name: 'Discard' }))
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

  /*
   * Escape is consumed, not merely observed. A Host closing its own side panel
   * on Escape would otherwise act on the same keystroke, so dismissing the
   * dialog would also tear down the UI behind it — and aria-modal="true" is a
   * claim that that UI is unreachable.
   */
  it('does not let Escape reach the Host behind it', async () => {
    const hostEscape = vi.fn()
    document.addEventListener('keydown', hostEscape)
    const onCancel = vi.fn()
    render(
      <HatuaProvider>
        <ConfirmDialog {...props} onCancel={onCancel} />
      </HatuaProvider>,
    )
    await screen.findByRole('dialog')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(hostEscape).not.toHaveBeenCalled()
    document.removeEventListener('keydown', hostEscape)
  })

  /*
   * aria-modal="true" tells assistive technology the rest of the page is
   * unreachable. Nothing in the markup makes that true — the backdrop stops
   * pointer users only — so without keeping Tab inside, a keyboard or screen
   * reader user can operate exactly the UI the dialog claims is blocked.
   */
  it('keeps Tab inside, in both directions', async () => {
    render(
      <HatuaProvider>
        <ConfirmDialog {...props} confirmLabel="Discard" />
      </HatuaProvider>,
    )
    const confirm = await screen.findByRole('button', { name: 'Discard' })
    const cancel = screen.getByRole('button', { name: 'Cancel' })

    // Confirm is focused on open and is the last stop, so Tab must wrap.
    expect(document.activeElement).toBe(confirm)
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(cancel)

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(confirm)
  })

  it('pulls focus back in when it has escaped the dialog entirely', async () => {
    render(
      <HatuaProvider>
        <ConfirmDialog {...props} confirmLabel="Discard" />
      </HatuaProvider>,
    )
    await screen.findByRole('dialog')
    ;(document.activeElement as HTMLElement | null)?.blur()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }))
  })

  // Otherwise focus lands on document.body and a keyboard user loses their
  // place in the designer the moment they answer.
  it('gives focus back to whatever had it before opening', async () => {
    function Harness() {
      const [open, setOpen] = useState(false)
      return (
        <HatuaProvider>
          <button type="button" onClick={() => setOpen(true)}>
            Discard Draft
          </button>
          <ConfirmDialog
            open={open}
            title="Discard this Draft?"
            onConfirm={() => setOpen(false)}
            onCancel={() => setOpen(false)}
          />
        </HatuaProvider>
      )
    }
    render(<Harness />)
    const trigger = screen.getByRole('button', { name: 'Discard Draft' })
    trigger.focus()
    fireEvent.click(trigger)

    expect(await screen.findByRole('button', { name: 'Confirm' })).toBe(document.activeElement)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(document.activeElement).toBe(trigger)
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
