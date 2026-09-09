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
 * **Text Mode** as a view composes it: reached from the toggle on the column,
 * taking the columns beside it with it, and asking before the screen changes
 * under text the document has not taken.
 *
 * The toggle is on the column rather than in the toolbar because the map and
 * the text are two ways of editing ONE document (ADR-0001) — so switching
 * between them changes nothing about which document is on screen, and the
 * control sits inside the thing showing it (ADR-0026).
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

/** Open the designer and press the toggle, which is how a reader arrives. */
const openText = async () => {
  render(<Hatua ports={{ workflows: workflows() }} workflowId="wf_morning" />)
  await settle()
  fireEvent.click(screen.getByRole('button', { name: 'YAML' }))
  await settle()
}

/**
 * The toggle, which names where it goes rather than where you are — so it reads
 * YAML on the map and Flow in the editor.
 */
const toggle = () =>
  screen.queryByRole('button', { name: 'YAML' }) ?? screen.getByRole('button', { name: 'Flow' })

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('Text Mode in the designer', () => {
  it('is reached from a toggle on the column, not from the toolbar', async () => {
    render(<Hatua ports={{ workflows: workflows() }} workflowId="wf_morning" />)
    await settle()

    // The bar asks which DOCUMENT is on screen and this asks how it is drawn.
    // With no `ExecutionSource` there is no other document, so the bar carries
    // no view control at all — and the toggle is still here.
    expect(screen.queryByRole('group', { name: 'View' })).toBeNull()
    // It names where it goes, so on the map it offers the YAML.
    expect(screen.getByRole('button', { name: 'YAML' })).toBeDefined()
  })

  it('takes the columns beside it, because they cannot act on the text', async () => {
    await openText()

    expect(box()).toBeDefined()
    // And in the editor it offers the way back.
    expect(screen.getByRole('button', { name: 'Flow' })).toBeDefined()
    /*
     * Not merely hidden — absent, and not for width. Each of them WRITES to the
     * document the box is holding, so one landing while text is uncommitted
     * would replace it: two writers, and the one being looked at loses. They are
     * also the map's tools, and in Text Mode their subject does not exist.
     */
    expect(screen.queryByRole('region', { name: 'Flow map' })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Components' })).toBeNull()
    expect(screen.queryByRole('complementary', { name: 'Inspector' })).toBeNull()
  })

  it('goes back to the map, on the same control', async () => {
    await openText()

    fireEvent.click(toggle())
    await settle()

    expect(screen.getByRole('region', { name: 'Flow map' })).toBeDefined()
    expect(screen.queryByRole('textbox', { name: 'Workflow YAML' })).toBeNull()
  })

  it('leaves without asking when the document has taken what was typed', async () => {
    await openText()

    fireEvent.change(box(), { target: { value: `${SOURCE}\n# a note\n` } })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    fireEvent.click(toggle())
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

    fireEvent.click(toggle())
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
    fireEvent.click(toggle())
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
    fireEvent.click(toggle())
    await settle()

    fireEvent.click(screen.getByRole('button', { name: 'Leave' }))
    await settle()

    expect(screen.getByRole('region', { name: 'Flow map' })).toBeDefined()
  })
})
