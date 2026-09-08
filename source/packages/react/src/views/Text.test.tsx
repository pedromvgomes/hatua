import type {
  Cursor,
  DraftSession,
  EditToken,
  Lease,
  PublishedVersion,
  VersionSummary,
  WorkflowStore,
} from '@hatua/services'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hatua } from './Hatua'

/**
 * The one thing `views/Text` adds over the region it mounts: it asks before the
 * screen changes under text the document has not taken.
 *
 * `<TextMode>` commits on a quiet period, so the only text it can still be
 * holding is text that will not parse — and nothing else on screen could ever
 * show it again. A region cannot refuse to be unmounted and should not try, so
 * this is where the question is asked.
 */

const SOURCE = `id: wf_morning
name: "Morning inbox triage"
version: 4
status: draft
steps:
  - id: s1
    use: component.email.fetch
    name: "Fetch the mail"
`

const token = 'tok_test' as EditToken
const lease: Lease = { token, expiresAt: '2099-01-01T00:00:00.000Z' }

const workflows = (): WorkflowStore => ({
  async openDraft(): Promise<DraftSession> {
    return { token, lease, yaml: SOURCE, resumed: false }
  },
  async saveDraft() {},
  async renewLease(): Promise<Lease> {
    return lease
  },
  async publish(): Promise<PublishedVersion> {
    return { version: 5, publishedAt: '2026-01-01T00:00:00.000Z' }
  },
  async releaseDraft() {},
  async discardDraft() {},
  async listVersions(): Promise<Cursor<VersionSummary>> {
    return { items: [] }
  },
  async loadVersion() {
    return SOURCE
  },
})

const settle = async () => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
}

const box = () => screen.getByRole('textbox', { name: 'Workflow YAML' }) as HTMLTextAreaElement

/** Open the designer and switch to Text Mode, which is how a reader arrives. */
const openText = async () => {
  render(<Hatua ports={{ workflows: workflows() }} workflowId="wf_morning" />)
  await settle()
  fireEvent.click(screen.getByRole('button', { name: 'Text' }))
  await settle()
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('the Text view', () => {
  it('is reached from the segmented control and takes the whole screen', async () => {
    await openText()

    expect(box()).toBeDefined()
    // Whole-screen: the state this view exists for empties the side panel, the
    // canvas and the step editor at once, so none of them is beside it.
    expect(screen.queryByRole('region', { name: 'Flow map' })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Components' })).toBeNull()
  })

  it('leaves without asking when the document has taken what was typed', async () => {
    await openText()

    fireEvent.change(box(), { target: { value: `${SOURCE}\n# a note\n` } })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    fireEvent.click(screen.getByRole('button', { name: 'Build' }))
    await settle()

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('region', { name: 'Flow map' })).toBeDefined()
  })

  it('asks before leaving under text the document could not take', async () => {
    await openText()

    // Two documents in one file: it cannot be held at all, so it is still only
    // in the box — and no other screen could show it again.
    fireEvent.change(box(), { target: { value: 'id: a\n---\nid: b\n' } })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })

    fireEvent.click(screen.getByRole('button', { name: 'Build' }))
    await settle()

    expect(screen.getByRole('dialog')).toBeDefined()
    // Still here: the question is asked before the screen changes, not after.
    expect(box()).toBeDefined()
  })

  it('stays put when the question is declined', async () => {
    await openText()
    fireEvent.change(box(), { target: { value: 'id: a\n---\nid: b\n' } })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    fireEvent.click(screen.getByRole('button', { name: 'Build' }))
    await settle()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await settle()

    expect(box().value).toContain('---')
    expect(screen.queryByRole('region', { name: 'Flow map' })).toBeNull()
  })

  it('goes once the loss is accepted', async () => {
    await openText()
    fireEvent.change(box(), { target: { value: 'id: a\n---\nid: b\n' } })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    fireEvent.click(screen.getByRole('button', { name: 'Build' }))
    await settle()

    fireEvent.click(screen.getByRole('button', { name: 'Leave' }))
    await settle()

    expect(screen.getByRole('region', { name: 'Flow map' })).toBeDefined()
  })
})
