import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
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
