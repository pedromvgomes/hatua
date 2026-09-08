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
import { HatuaProvider, useEditingStore } from '../theme/HatuaProvider'
import { TextMode } from './TextMode'

/**
 * The one surface that renders `text` rather than `definition`.
 *
 * What is worth asserting is the pair of properties every other region is the
 * opposite of: this one takes a document that does not project, and it is the
 * one place a document that no other region can draw is repaired (ADR-0001,
 * ADR-0026).
 */

const SOURCE = `# Triage the overnight inbox before standup.
id: wf_morning
name: "Morning inbox triage"
version: 4
status: draft
steps:
  - id: s1
    use: component.email.fetch
`

const token = 'tok_test' as EditToken
const lease: Lease = { token, expiresAt: '2099-01-01T00:00:00.000Z' }

interface Host {
  port: WorkflowStore
  writes: string[]
}

const host = (yaml = SOURCE): Host => {
  const writes: string[] = []
  return {
    writes,
    port: {
      async openDraft(): Promise<DraftSession> {
        return { token, lease, yaml, resumed: false }
      },
      async saveDraft(_token, text) {
        writes.push(text)
      },
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
        return yaml
      },
    },
  }
}

const mount = (store: WorkflowStore | null, props: Parameters<typeof TextMode>[0] = {}) =>
  render(
    <HatuaProvider
      ports={store ? { workflows: store } : {}}
      workflowId={store ? 'wf_morning' : undefined}
    >
      <TextMode {...props} />
    </HatuaProvider>,
  )

const box = () => screen.getByRole('textbox', { name: 'Workflow YAML' }) as HTMLTextAreaElement

/**
 * Let the open land.
 *
 * Timers are faked throughout, because the quiet period before a commit is what
 * most of these are about — so nothing here can wait on wall-clock time, and the
 * pending microtasks are advanced explicitly instead.
 */
const settle = async () => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
}

/**
 * Type, then wait out both quiet periods a keystroke passes through: this box's
 * before the document takes it, and the store's before the Host does.
 */
const type = async (text: string) => {
  fireEvent.change(box(), { target: { value: text } })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('what it shows', () => {
  it('says the port is missing rather than an empty box', () => {
    vi.useRealTimers()
    mount(null)
    expect(screen.getByText(/No workflow is wired up/)).toBeDefined()
  })

  it('shows the file as the Host stored it, comments and quoting included', async () => {
    mount(host().port)
    await settle()

    // ADR-0001 makes the text the source of truth, so this is the document
    // itself and not a re-serialisation of a typed projection.
    expect(box().value).toContain('# Triage the overnight inbox before standup.')
    expect(box().value).toContain('name: "Morning inbox triage"')
  })
})

describe('what is typed', () => {
  it('becomes the document on a quiet period, not per keystroke', async () => {
    const wired = host()
    mount(wired.port)
    await settle()

    fireEvent.change(box(), { target: { value: `${SOURCE}\n# and a note\n` } })
    expect(wired.writes).toEqual([])

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    expect(wired.writes.at(-1)).toContain('# and a note')
  })

  it('takes a document that is not a workflow, which is what this screen is for', async () => {
    mount(host().port)
    await settle()

    await type('id: wf_morning\nsteps: nonsense\n')

    // The projection backstop refuses a command that breaks it; `setText` is
    // exempt, because the reader is looking at what broke it (ADR-0026).
    expect(screen.getByText(/Not a workflow yet/)).toBeDefined()
    expect(box().value).toContain('nonsense')
  })

  it('keeps text that will not parse in the box, and says why', async () => {
    const wired = host()
    mount(wired.port)
    await settle()

    await type('id: a\n---\nid: b\n')

    // Two documents in one file cannot be held at all: every command reaches
    // through the AST, and there would be no AST.
    expect(box().value).toContain('---')
    expect(wired.writes).toEqual([])
    expect(screen.getByRole('region', { name: 'Text' }).textContent).toContain('document')
  })

  it('commits on blur, because that is the reader saying they are done', async () => {
    const wired = host()
    mount(wired.port)
    await settle()

    fireEvent.change(box(), { target: { value: `${SOURCE}\n# blurred\n` } })
    fireEvent.blur(box())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })

    expect(wired.writes.at(-1)).toContain('# blurred')
  })

  it('reports whether the document has taken what is in the box', async () => {
    const seen: boolean[] = []
    mount(host().port, { onUnsavedChange: (unsaved) => seen.push(unsaved) })
    await settle()

    await type('id: a\n---\nid: b\n')
    expect(seen.at(-1)).toBe(true)

    await type(`${SOURCE}\n# fixed\n`)
    // Reported on the way back down too, so a view holding the answer is never
    // left believing there is text to lose after it has been taken.
    expect(seen.at(-1)).toBe(false)
  })
})

/** Undoes the last edit, the way nothing on screen does yet — but the store can. */
function Undoing() {
  const store = useEditingStore()
  return (
    <button type="button" onClick={() => store?.undo()}>
      Undo
    </button>
  )
}

/** Ends the session the way a toolbar does, from inside the provider. */
function Ending() {
  const store = useEditingStore()
  return (
    <button type="button" onClick={() => void store?.release()}>
      Release
    </button>
  )
}

describe('what it will not do', () => {
  it('goes read-only when the session ends, and stays readable', async () => {
    const wired = host()
    render(
      <HatuaProvider ports={{ workflows: wired.port }} workflowId="wf_morning">
        <Ending />
        <TextMode />
      </HatuaProvider>,
    )
    await settle()
    expect(box().readOnly).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'Release' }))
    await settle()

    /*
     * `useReadOnly()`'s answer, not this region's — the mistake the step editor
     * made once was deriving it locally (ADR-0024).
     *
     * Readable is the point. The in-memory document is intact and saved nowhere,
     * and this is where it can be selected and taken away, which is the escape
     * the design handoff had no answer for.
     */
    expect(box().readOnly).toBe(true)
    expect(box().value).toContain('name: "Morning inbox triage"')
  })

  it('leaves the identity keys alone whatever the reader types over them', async () => {
    const wired = host()
    mount(wired.port)
    await settle()

    await type('id: something_else\nname: Typed\nversion: 99\nstatus: published\nsteps: []\n')

    // `publish()` sends the document's own bytes, so a text edit that renumbered
    // the Draft would promote a version claiming to be an already-published one.
    expect(wired.writes.length).toBeGreaterThan(0)
    const written = wired.writes.at(-1) ?? ''
    expect(written).toContain('id: wf_morning')
    expect(written).toContain('version: 4')
    expect(written).toContain('status: draft')
    expect(written).toContain('name: Typed')
  })
})

describe('what the box holds after the document has taken it', () => {
  /*
   * A commit re-serialises: `replaceContent` writes the **Draft**'s `id`,
   * `version` and `status` back in, and the serialiser normalises quoting, flow
   * style and the trailing newline. So the document's text after a commit is
   * routinely NOT the text that was typed — the commonest case being a caret at
   * the end of a document with no trailing newline, which every commit adds.
   *
   * The box must go on showing what was typed. Swapping it for the
   * serialisation moves text under a caret the browser holds by index, so the
   * next keystroke lands somewhere else entirely and a click aims at glyphs that
   * are no longer where they were drawn.
   */
  it('sends the Host the bytes that were typed, not a serialisation of them', async () => {
    const wired = host()
    mount(wired.port)
    await settle()

    // No trailing newline, and none is added: the reader is the serialiser here,
    // so the document becomes the text rather than the text being written into
    // the document (ADR-0001).
    const TYPED = 'id: wf_morning\nname: n\nversion: 4\nstatus: draft\nsteps: []'
    await type(TYPED)

    expect(wired.writes.at(-1)).toBe(TYPED)
    expect(box().value).toBe(TYPED)
  })

  it('keeps the comment alignment the author chose', async () => {
    const wired = host()
    mount(wired.port)
    await settle()

    // The seed every playground reader opens has one of these. Re-serialising
    // pulls it back to a single space, which is Hatua rewriting a file it does
    // not own while the author watches.
    const TYPED =
      'id: wf_morning\nname: n\nversion: 4\nstatus: draft\nsteps:\n  - id: s1\n    use: a.b\n    with:\n      folder: INBOX      # not Archive\n'
    await type(TYPED)

    expect(wired.writes.at(-1)).toBe(TYPED)
  })

  it('keeps what was typed when the commit writes the identity keys back in', async () => {
    const wired = host()
    mount(wired.port)
    await settle()

    // `id`, `version` and `status` are the Draft's whatever the source says, so
    // a document typed without them comes back with them.
    const TYPED = 'name: renamed\nsteps: []\n'
    await type(TYPED)

    expect(wired.writes.at(-1)).toContain('id: wf_morning')
    expect(box().value).toBe(TYPED)
  })

  it('still follows the document when it moves for a reason of its own', async () => {
    const wired = host()
    render(
      <HatuaProvider ports={{ workflows: wired.port }} workflowId="wf_morning">
        <Undoing />
        <TextMode />
      </HatuaProvider>,
    )
    await settle()
    await type('name: renamed\nsteps: []\n')
    expect(box().value).toContain('renamed')

    // An undo is not this box's edit, so the box adopts rather than holding on
    // to text the document no longer has.
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await settle()

    expect(box().value).toContain('Morning inbox triage')
    expect(box().value).not.toContain('renamed')
  })
})
