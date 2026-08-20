import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createEditingStore, type EditingSnapshot } from './editing'
import type {
  Cursor,
  DraftSession,
  EditToken,
  Lease,
  PublishedVersion,
  VersionSummary,
  WorkflowStore,
} from './ports'
import { addStep, moveStep, removeStep } from './steps'

/**
 * There is no region reading this store until the Flow tab, so these tests are
 * most of the proof — the bargain store.ts states: "the editing engine is
 * testable without a renderer."
 *
 * The fixture is written the way a user's file is: comments, a chosen key
 * order, quoting the author picked. Round trip is the property that matters
 * most here (ADR-0001), and it is asserted after edits rather than only on an
 * untouched document, because an untouched document round-tripping was already
 * true before anything could edit one.
 */
const SOURCE = `# Triage the overnight inbox before standup.
id: wf_morning
name: "Morning inbox triage"
version: 4
status: draft

steps:
  - id: s1
    use: email.fetch
    name: "Fetch mail"
    with:
      folder: INBOX      # not Archive
  - id: s2
    use: core.fork
    branches:
      - label: Urgent
        when: "{{ s1.count > 10 }}"
        steps:
          - id: s3
            use: email.send
      - label: Otherwise
        steps: []
  - id: s4
    use: core.for_each
    steps:
      - id: s5
        use: agent.classify
`

const token = 'tok_1' as EditToken

const leaseFor = (minutes: number): Lease => ({
  token,
  expiresAt: new Date(Date.now() + minutes * 60_000).toISOString(),
})

interface Recorder {
  port: WorkflowStore
  writes: string[]
  renewals: number
  opens: number
  published: string[]
  released: number
  discarded: number
}

/**
 * A Host, faked at the port rather than below it. Every option here is a real
 * Host behaviour: one that rejects a write is the case ADR-0005's "a rejected
 * write halts autosave" exists for, and it is the one the playground's
 * Host-authored entry also puts on screen.
 */
function recorder(
  options: {
    yaml?: string
    resumed?: boolean
    /** Thrown from a NON-async openDraft, i.e. before any promise exists. */
    throwSynchronously?: unknown
    lease?: Lease
    rejectSave?: Error
    rejectRenew?: Error
    rejectOpen?: unknown
    throwOnOpen?: unknown
  } = {},
): Recorder {
  const state: Recorder = {
    writes: [],
    renewals: 0,
    opens: 0,
    published: [],
    released: 0,
    discarded: 0,
    port: undefined as unknown as WorkflowStore,
  }

  const opened = async (): Promise<DraftSession> => {
    if (options.throwOnOpen) throw options.throwOnOpen
    if (options.rejectOpen) return Promise.reject(options.rejectOpen)
    return {
      token,
      lease: options.lease ?? leaseFor(30),
      yaml: options.yaml ?? SOURCE,
      resumed: options.resumed ?? false,
    }
  }

  state.port = {
    // Deliberately NOT `async`. A port method is a plain method on the Host's
    // object and nothing obliges it to return a promise at all, so a fake whose
    // every method is `async` cannot reach the one path that exists for the
    // Host whose isn't. See the synchronous-throw test below.
    openDraft(): Promise<DraftSession> {
      state.opens++
      if (options.throwSynchronously) throw options.throwSynchronously
      return opened()
    },
    async saveDraft(_token: EditToken, yaml: string) {
      if (options.rejectSave) throw options.rejectSave
      state.writes.push(yaml)
    },
    async renewLease(): Promise<Lease> {
      state.renewals++
      if (options.rejectRenew) throw options.rejectRenew
      return options.lease ?? leaseFor(30)
    },
    async publish(_token: EditToken, yaml: string): Promise<PublishedVersion> {
      state.published.push(yaml)
      return { version: 5, publishedAt: '2026-01-01T00:00:00.000Z' }
    },
    async releaseDraft() {
      state.released++
    },
    async discardDraft() {
      state.discarded++
    },
    async listVersions(): Promise<Cursor<VersionSummary>> {
      return { items: [] }
    },
    async loadVersion() {
      return SOURCE
    },
  }

  return state
}

/**
 * Drain the microtask queue without letting the autosave timer fire.
 *
 * Several turns, not one: a port method that is `async` and returns a promise
 * adopts it, which costs an extra tick — so a single microtask is enough to see
 * some rejections and not others, which is a flake rather than a test.
 */
const settle = async () => {
  for (let turn = 0; turn < 8; turn++) await Promise.resolve()
}

const ready = (store: { getSnapshot(): unknown }): EditingSnapshot => {
  const state = store.getSnapshot() as { status: string; workflow?: EditingSnapshot }
  if (state.status !== 'ready' || !state.workflow) {
    throw new Error(`expected a ready store, got "${state.status}"`)
  }
  return state.workflow
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('opening a draft', () => {
  it('does nothing until somebody asks, because openDraft claims the edit', async () => {
    // Lazy for a stronger reason than the manifest store's: this call takes a
    // lease. A Host mounting a region that never reads the document must not
    // lock a workflow nobody is editing.
    const host = recorder()
    createEditingStore(host.port, 'wf_morning')
    await settle()
    expect(host.opens).toBe(0)
  })

  it('opens once however many readers call open()', async () => {
    const host = recorder()
    const store = createEditingStore(host.port, 'wf_morning')
    store.open()
    store.open()
    store.open()
    await settle()
    expect(host.opens).toBe(1)
  })

  it('starts opening and lands ready with the Host’s document', async () => {
    const host = recorder()
    const store = createEditingStore(host.port, 'wf_morning')
    expect(store.getSnapshot().status).toBe('opening')

    store.open()
    await settle()
    expect(ready(store).definition?.id).toBe('wf_morning')
  })

  it('carries `resumed`, because taking over someone’s Draft is not the same as making one', async () => {
    const host = recorder({ resumed: true })
    const store = createEditingStore(host.port, 'wf_morning')
    store.open()
    await settle()
    expect(ready(store).resumed).toBe(true)
  })

  it('fails rather than opening when the Host rejects', async () => {
    const host = recorder({ rejectOpen: new Error('Someone else holds the draft.') })
    const store = createEditingStore(host.port, 'wf_morning')
    store.open()
    await settle()
    expect(store.getSnapshot()).toMatchObject({
      status: 'failed',
      error: { message: 'Someone else holds the draft.' },
    })
  })

  it('survives a Host whose openDraft rejects with something that is not an Error', async () => {
    const host = recorder({ rejectOpen: 'the endpoint said no' })
    const store = createEditingStore(host.port, 'wf_morning')
    store.open()
    await settle()
    expect(store.getSnapshot()).toMatchObject({
      status: 'failed',
      error: { message: 'the endpoint said no' },
    })
  })

  it('survives a Host whose openDraft throws synchronously', async () => {
    // Nothing obliges a port method to be `async`, and this fake's is not. One
    // that throws on a bad base URL before returning any promise at all would
    // otherwise throw straight out of open(), which a region calls inside an
    // effect — taking the React tree down instead of rendering a failure.
    const host = recorder({ throwSynchronously: 'no base url configured' })
    const store = createEditingStore(host.port, 'wf_morning')
    expect(() => store.open()).not.toThrow()
    await settle()
    expect(store.getSnapshot().status).toBe('failed')
  })

  it('reopen() retries after a failure', async () => {
    const host = recorder({ rejectOpen: new Error('nope') })
    const store = createEditingStore(host.port, 'wf_morning')
    store.open()
    await settle()
    expect(store.getSnapshot().status).toBe('failed')

    store.reopen()
    expect(store.getSnapshot().status).toBe('opening')
    expect(host.opens).toBe(2)
  })
})

describe('a document that does not project', () => {
  /*
   * The state the whole design turns on. `toJSON()` throws when the source is
   * not a valid Workflow Definition, and that is legitimate — someone is
   * halfway through typing in Text Mode. The store has to HOLD such a document.
   */
  it('opens a parseable document that is not a Workflow Definition', async () => {
    const host = recorder({ yaml: 'name: half written\n' })
    const store = createEditingStore(host.port, 'wf_morning')
    store.open()
    await settle()

    const snapshot = ready(store)
    expect(snapshot.definition).toBeNull()
    expect(snapshot.invalid).toBeInstanceOf(Error)
    expect(snapshot.text).toBe('name: half written\n')
  })

  it('fails only when the YAML itself will not parse, because there is no AST to edit', async () => {
    const host = recorder({ yaml: 'steps: [unclosed\n' })
    const store = createEditingStore(host.port, 'wf_morning')
    store.open()
    await settle()
    expect(store.getSnapshot().status).toBe('failed')
  })

  it('refuses a multi-document source at the seam rather than losing half of it later', async () => {
    const host = recorder({ yaml: `${SOURCE}---\nid: wf_other\n` })
    const store = createEditingStore(host.port, 'wf_morning')
    store.open()
    await settle()
    expect(store.getSnapshot()).toMatchObject({
      status: 'failed',
      error: { message: /single YAML document/ },
    })
  })
})

describe('getSnapshot stability', () => {
  it('returns the same object until something changes', async () => {
    // Not decorative: a getSnapshot that builds a fresh object every call makes
    // useSyncExternalStore re-render forever, and the failure surfaces in the
    // component rather than in the store that caused it (store.ts).
    const host = recorder()
    const store = createEditingStore(host.port, 'wf_morning')
    store.open()
    await settle()

    const first = store.getSnapshot()
    expect(store.getSnapshot()).toBe(first)

    store.apply(removeStep('s1'))
    expect(store.getSnapshot()).not.toBe(first)
    expect(store.getSnapshot()).toBe(store.getSnapshot())
  })

  it('notifies subscribers and stops when they unsubscribe', async () => {
    const host = recorder()
    const store = createEditingStore(host.port, 'wf_morning')
    const seen = vi.fn()
    const stop = store.subscribe(seen)

    store.open()
    await settle()
    expect(seen).toHaveBeenCalled()

    stop()
    const before = seen.mock.calls.length
    store.apply(removeStep('s1'))
    expect(seen.mock.calls.length).toBe(before)
  })
})

describe('commands', () => {
  const open = async () => {
    const host = recorder()
    const store = createEditingStore(host.port, 'wf_morning')
    store.open()
    await settle()
    return { host, store }
  }

  it('adds a Step at the root, minting the next free id', async () => {
    const { store } = await open()
    store.apply(addStep({ use: 'email.send', name: 'Reply' }, { index: 1 }))

    const steps = ready(store).definition?.steps ?? []
    expect(steps.map((step) => step.id)).toEqual(['s1', 's6', 's2', 's4'])
    expect(steps[1]?.use).toBe('email.send')
  })

  it('appends when the index is past the end', async () => {
    const { store } = await open()
    store.apply(addStep({ use: 'email.send' }, { index: 99 }))
    expect(ready(store).definition?.steps.at(-1)?.id).toBe('s6')
  })

  it('adds into a Branch, creating the sequence an empty one does not have', async () => {
    // "Otherwise" is written `steps: []` in the fixture; a Branch a user has
    // not filled in may have no `steps:` key at all, and the first drop into it
    // has to work either way.
    const { store } = await open()
    store.apply(addStep({ use: 'email.send' }, { parentId: 's2', branchIndex: 1, index: 0 }))

    const fork = ready(store).definition?.steps.find((step) => step.id === 's2')
    expect(fork?.branches?.[1]?.steps.map((step) => step.id)).toEqual(['s6'])
  })

  it('adds into a loop’s own steps, which take no branch wrapper', async () => {
    const { store } = await open()
    store.apply(addStep({ use: 'email.send' }, { parentId: 's4', index: 1 }))

    const loop = ready(store).definition?.steps.find((step) => step.id === 's4')
    expect(loop?.steps?.map((step) => step.id)).toEqual(['s5', 's6'])
  })

  it('removes a Step, and a container takes its subtree with it', async () => {
    const { store } = await open()
    store.apply(removeStep('s2'))

    const steps = ready(store).definition?.steps ?? []
    expect(steps.map((step) => step.id)).toEqual(['s1', 's4'])
    expect(ready(store).text).not.toContain('s3')
  })

  it('removes a nested Step without touching its siblings', async () => {
    const { store } = await open()
    store.apply(removeStep('s3'))

    const fork = ready(store).definition?.steps.find((step) => step.id === 's2')
    expect(fork?.branches?.[0]?.steps).toEqual([])
    expect(fork?.branches?.[1]?.label).toBe('Otherwise')
  })

  it('moves a Step within its own list without overshooting', async () => {
    // Detaching shifts everything after it down one, so "move s1 to index 2"
    // means "after s2" and lands at index 1 once the list is a step shorter.
    const { store } = await open()
    store.apply(moveStep('s1', { index: 2 }))
    expect(ready(store).definition?.steps.map((step) => step.id)).toEqual(['s2', 's1', 's4'])
  })

  it('moves a Step out of a Branch and up to the root', async () => {
    const { store } = await open()
    store.apply(moveStep('s3', { index: 0 }))

    const steps = ready(store).definition?.steps ?? []
    expect(steps.map((step) => step.id)).toEqual(['s3', 's1', 's2', 's4'])
    const fork = steps.find((step) => step.id === 's2')
    expect(fork?.branches?.[0]?.steps).toEqual([])
  })

  it('moves a Step INTO a container that sits after it in the same list', async () => {
    /*
     * Detaching a Step shifts every sibling after it down one, so a
     * destination inside one of those siblings moves too:
     * `steps.1.branches.0.steps` becomes `steps.0.branches.0.steps`. A path
     * resolved before the detach points at nothing afterwards, `insertNode`
     * takes its "the sequence does not exist yet" branch, and `setIn`
     * fabricates a whole new root Step — the document stops validating and the
     * dragged Step lands inside a node nobody wrote.
     */
    const { store } = await open()
    store.apply(moveStep('s1', { parentId: 's2', branchIndex: 1, index: 0 }))

    const snapshot = ready(store)
    expect(snapshot.invalid).toBeNull()

    const steps = snapshot.definition?.steps ?? []
    expect(steps.map((step) => step.id)).toEqual(['s2', 's4'])

    const fork = steps.find((step) => step.id === 's2')
    expect(fork?.branches?.[1]?.steps.map((step) => step.id)).toEqual(['s1'])
    // No fabricated node anywhere.
    expect(snapshot.text).not.toContain('- branches:')
  })

  it('moves a Step out of a loop that sits after it once the list has closed up', async () => {
    const { store } = await open()
    store.apply(moveStep('s1', { parentId: 's4', index: 0 }))

    const snapshot = ready(store)
    expect(snapshot.invalid).toBeNull()
    const loop = snapshot.definition?.steps.find((step) => step.id === 's4')
    expect(loop?.steps?.map((step) => step.id)).toEqual(['s1', 's5'])
  })

  it('addresses the right Step when the list holds a hole a user left mid-edit', async () => {
    // A bare `-` is a null item, and `steps:` is allowed to hold one while
    // someone is typing. The walk's indices go straight to the AST sequence, so
    // compacting the hole out renumbers everything after it and the wrong Step
    // is deleted.
    const host = recorder({
      yaml: 'id: w\nname: n\nversion: 1\nstatus: draft\nsteps:\n  -\n  - id: s1\n    use: a\n  - id: s2\n    use: b\n',
    })
    const store = createEditingStore(host.port, 'w')
    store.open()
    await settle()

    store.apply(removeStep('s2'))
    expect(ready(store).text).toContain('id: s1')
    expect(ready(store).text).not.toContain('id: s2')
  })

  it('refuses to move a container inside itself', async () => {
    // Otherwise the subtree is detached and spliced into a sequence that lives
    // inside the detached node: the Step and everything under it disappear from
    // the document with no error anywhere.
    const { store } = await open()
    const before = ready(store).text
    store.apply(moveStep('s2', { parentId: 's2', branchIndex: 0, index: 0 }))
    expect(ready(store).text).toBe(before)
  })

  it('treats a command that cannot find its Step as a no-op, not half an edit', async () => {
    const { store } = await open()
    const before = ready(store).text
    store.apply(removeStep('s99'))

    expect(ready(store).text).toBe(before)
    expect(ready(store).undoLabel).toBeNull()
  })
})

describe('round trip', () => {
  /*
   * ADR-0001's promise, and the reason the store holds a document rather than a
   * typed graph: Hatua does not own the file, so a document opened, edited and
   * serialised keeps the user's comments, key order and quoting. The whole
   * point of testing it HERE rather than only in @hatua/document is that these
   * edits arrive through the command mechanism, which is the thing a canvas
   * will drive.
   */
  const edited = async () => {
    const host = recorder()
    const store = createEditingStore(host.port, 'wf_morning')
    store.open()
    await settle()
    store.apply(addStep({ use: 'email.send', name: 'Reply' }, { index: 1 }))
    return { host, store }
  }

  it('keeps the comments the user wrote', async () => {
    const { store } = await edited()
    const text = ready(store).text
    expect(text).toContain('# Triage the overnight inbox before standup.')
    expect(text).toContain('# not Archive')
  })

  it('keeps the author’s key order rather than the schema’s', async () => {
    const { store } = await edited()
    const text = ready(store).text
    expect(text.indexOf('id: wf_morning')).toBeLessThan(text.indexOf('name: "Morning'))
    expect(text.indexOf('name: "Morning')).toBeLessThan(text.indexOf('version: 4'))
  })

  it('keeps the author’s quoting', async () => {
    const { store } = await edited()
    expect(ready(store).text).toContain('name: "Morning inbox triage"')
    expect(ready(store).text).toContain('when: "{{ s1.count > 10 }}"')
  })

  it('leaves an untouched document byte-identical', async () => {
    const host = recorder()
    const store = createEditingStore(host.port, 'wf_morning')
    store.open()
    await settle()
    expect(ready(store).text).toBe(SOURCE)
  })

  it('moves a Step’s own comment with it', async () => {
    const yaml = `id: wf\nname: n\nversion: 1\nstatus: draft\nsteps:\n  - id: s1\n    use: a\n  # why this one is second\n  - id: s2\n    use: b\n`
    const host = recorder({ yaml })
    const store = createEditingStore(host.port, 'wf')
    store.open()
    await settle()

    store.apply(moveStep('s2', { index: 0 }))
    const text = ready(store).text
    expect(text).toContain('# why this one is second')
    expect(text.indexOf('# why this one is second')).toBeLessThan(text.indexOf('id: s1'))
  })
})

describe('undo and redo', () => {
  const open = async () => {
    const host = recorder()
    const store = createEditingStore(host.port, 'wf_morning')
    store.open()
    await settle()
    return { host, store }
  }

  it('restores the previous text exactly, comments included', async () => {
    const { store } = await open()
    store.apply(removeStep('s2'))
    expect(ready(store).text).not.toBe(SOURCE)

    store.undo()
    expect(ready(store).text).toBe(SOURCE)
  })

  it('names what it would undo, so a control can label itself', async () => {
    const { store } = await open()
    expect(ready(store).undoLabel).toBeNull()

    store.apply(addStep({ use: 'email.send', name: 'Reply' }, { index: 0 }))
    expect(ready(store).undoLabel).toBe('Add Reply')
    expect(ready(store).redoLabel).toBeNull()

    store.undo()
    expect(ready(store).undoLabel).toBeNull()
    expect(ready(store).redoLabel).toBe('Add Reply')
  })

  it('redoes what it undid', async () => {
    const { store } = await open()
    store.apply(removeStep('s1'))
    const after = ready(store).text

    store.undo()
    store.redo()
    expect(ready(store).text).toBe(after)
  })

  it('walks several edits back in order', async () => {
    const { store } = await open()
    store.apply(removeStep('s1'))
    store.apply(removeStep('s4'))
    expect(ready(store).definition?.steps.map((step) => step.id)).toEqual(['s2'])

    store.undo()
    expect(ready(store).definition?.steps.map((step) => step.id)).toEqual(['s2', 's4'])
    store.undo()
    expect(ready(store).text).toBe(SOURCE)
  })

  it('drops the redo stack once a new edit makes it unreachable', async () => {
    const { store } = await open()
    store.apply(removeStep('s1'))
    store.undo()
    expect(ready(store).redoLabel).not.toBeNull()

    store.apply(removeStep('s4'))
    expect(ready(store).redoLabel).toBeNull()
  })

  it('does nothing on an empty stack', async () => {
    const { store } = await open()
    expect(() => {
      store.undo()
      store.redo()
    }).not.toThrow()
    expect(ready(store).text).toBe(SOURCE)
  })
})

describe('autosave', () => {
  const open = async (options = {}) => {
    const host = recorder(options)
    const store = createEditingStore(host.port, 'wf_morning', { autosaveDelayMs: 500 })
    store.open()
    await settle()
    return { host, store }
  }

  it('writes after the quiet period, with no Save button anywhere', async () => {
    const { host, store } = await open()
    store.apply(removeStep('s1'))
    expect(ready(store).save).toEqual({ state: 'pending' })
    expect(host.writes).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(500)
    expect(host.writes).toHaveLength(1)
    expect(ready(store).save).toEqual({ state: 'saved' })
  })

  it('writes the document’s text, not a re-serialisation of the projection', async () => {
    const { host, store } = await open()
    store.apply(removeStep('s1'))
    await vi.advanceTimersByTimeAsync(500)
    expect(host.writes[0]).toContain('# Triage the overnight inbox before standup.')
  })

  it('coalesces a burst of edits into one write', async () => {
    const { host, store } = await open()
    store.apply(removeStep('s1'))
    await vi.advanceTimersByTimeAsync(200)
    store.apply(removeStep('s4'))
    await vi.advanceTimersByTimeAsync(200)
    expect(host.writes).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(500)
    expect(host.writes).toHaveLength(1)
  })

  it('writes an undo too, because undoing is an edit like any other', async () => {
    const { host, store } = await open()
    store.apply(removeStep('s1'))
    await vi.advanceTimersByTimeAsync(500)
    store.undo()
    await vi.advanceTimersByTimeAsync(500)

    expect(host.writes).toHaveLength(2)
    expect(host.writes[1]).toBe(SOURCE)
  })

  it('skips the write when an undo has put the document back where the Host has it', async () => {
    // The edit and its undo both scheduled a save; by the time the timer fires
    // the text is what was last accepted. Writing it would be a round trip to
    // say nothing, and reporting `pending` afterwards would be a lie.
    const { host, store } = await open()
    store.apply(removeStep('s1'))
    await vi.advanceTimersByTimeAsync(200)
    store.undo()

    await vi.advanceTimersByTimeAsync(500)
    expect(host.writes).toHaveLength(0)
    expect(ready(store).save).toEqual({ state: 'saved' })
  })

  it('does not write when nothing changed', async () => {
    const { host, store } = await open()
    store.apply(removeStep('s99'))
    await vi.advanceTimersByTimeAsync(2000)
    expect(host.writes).toHaveLength(0)
  })

  it('flush() writes now rather than waiting the delay out', async () => {
    const { host, store } = await open()
    store.apply(removeStep('s1'))
    await store.flush()
    expect(host.writes).toHaveLength(1)
  })

  /*
   * ADR-0005: "A rejected write halts autosave and keeps the in-memory document
   * rather than retrying or discarding."
   *
   * Both halves are the point. Retrying would hammer a Host that has already
   * said no — a lease that went to someone else does not come back by asking
   * harder — and discarding would throw away the user's work to resolve a
   * conflict nobody has told them about.
   */
  describe('when the Host rejects a write', () => {
    it('halts, and stays halted through later edits', async () => {
      const { host, store } = await open({ rejectSave: new Error('Lease expired.') })
      store.apply(removeStep('s1'))
      await vi.advanceTimersByTimeAsync(500)

      expect(ready(store).save).toEqual({ state: 'halted', error: new Error('Lease expired.') })

      store.apply(removeStep('s4'))
      await vi.advanceTimersByTimeAsync(10_000)
      expect(host.writes).toHaveLength(0)
      expect(ready(store).save).toMatchObject({ state: 'halted' })
    })

    it('does not spin: exactly one attempt was made', async () => {
      const attempts: string[] = []
      const host = recorder()
      host.port.saveDraft = async (_token, yaml) => {
        attempts.push(yaml)
        throw new Error('nope')
      }
      const store = createEditingStore(host.port, 'wf_morning', { autosaveDelayMs: 500 })
      store.open()
      await settle()

      store.apply(removeStep('s1'))
      await vi.advanceTimersByTimeAsync(60_000)
      expect(attempts).toHaveLength(1)
    })

    it('keeps the in-memory document, and keeps it editable', async () => {
      const { store } = await open({ rejectSave: new Error('Lease expired.') })
      store.apply(removeStep('s1'))
      await vi.advanceTimersByTimeAsync(500)

      // Not reverted to what the Host last accepted...
      expect(ready(store).definition?.steps.map((s) => s.id)).toEqual(['s2', 's4'])

      // ...and still an editor, not a read-only view of lost work.
      store.apply(removeStep('s4'))
      expect(ready(store).definition?.steps.map((s) => s.id)).toEqual(['s2'])
      store.undo()
      expect(ready(store).definition?.steps.map((s) => s.id)).toEqual(['s2', 's4'])
    })
  })

  it('never has two writes open at once, whatever the Host takes to answer', async () => {
    /*
     * Two overlapping saveDraft calls can land in either order, and a Host that
     * applies the older one last is left holding text the user has moved past.
     * Reachable whenever a write takes longer than the autosave delay.
     */
    let open = 0
    let peak = 0
    const releases: (() => void)[] = []
    const host = recorder()
    host.port.saveDraft = async (_token, yaml) => {
      open++
      peak = Math.max(peak, open)
      await new Promise<void>((resolve) => releases.push(resolve))
      open--
      host.writes.push(yaml)
    }
    const store = createEditingStore(host.port, 'wf_morning', { autosaveDelayMs: 500 })
    store.open()
    await settle()

    store.apply(removeStep('s1'))
    await vi.advanceTimersByTimeAsync(500)
    store.apply(removeStep('s4'))
    await vi.advanceTimersByTimeAsync(500)

    expect(peak).toBe(1)

    // The write that was open reschedules on completion, so the later edit is
    // not dropped by having waited.
    releases.shift()?.()
    await settle()
    await vi.advanceTimersByTimeAsync(500)
    releases.shift()?.()
    await settle()

    expect(peak).toBe(1)
    expect(host.writes).toHaveLength(2)
    expect(host.writes[1]).not.toContain('id: s4')
  })

  it('reschedules rather than reporting saved when the user typed during the write', async () => {
    // Otherwise the last few edits are reported written when they are not,
    // which is the one autosave failure a user cannot see coming.
    let release: (() => void) | undefined
    const host = recorder()
    // Only the FIRST write is held open; the one the store reschedules must be
    // able to complete, or this test would pass for the wrong reason.
    host.port.saveDraft = async (_token, yaml) => {
      if (host.writes.length === 0 && !release) {
        await new Promise<void>((resolve) => {
          release = resolve
        })
      }
      host.writes.push(yaml)
    }
    const store = createEditingStore(host.port, 'wf_morning', { autosaveDelayMs: 500 })
    store.open()
    await settle()

    store.apply(removeStep('s1'))
    await vi.advanceTimersByTimeAsync(500)
    expect(ready(store).save).toEqual({ state: 'saving' })

    store.apply(removeStep('s4'))
    release?.()
    await settle()
    expect(ready(store).save).toEqual({ state: 'pending' })

    await vi.advanceTimersByTimeAsync(500)
    expect(host.writes).toHaveLength(2)
  })
})

describe('the lease', () => {
  it('renews at the halfway mark, so one lost renewal still leaves time to retry', async () => {
    const host = recorder({ lease: leaseFor(30) })
    const store = createEditingStore(host.port, 'wf_morning')
    store.open()
    await settle()

    await vi.advanceTimersByTimeAsync(14 * 60_000)
    expect(host.renewals).toBe(0)
    await vi.advanceTimersByTimeAsync(2 * 60_000)
    expect(host.renewals).toBe(1)
  })

  it('halts autosave when the claim is lost, before a write finds out the hard way', async () => {
    const host = recorder({ lease: leaseFor(30), rejectRenew: new Error('Lease taken.') })
    const store = createEditingStore(host.port, 'wf_morning')
    store.open()
    await settle()

    await vi.advanceTimersByTimeAsync(16 * 60_000)
    expect(ready(store).save).toMatchObject({ state: 'halted' })
  })

  it('does not busy-loop on a lease that expires years from now', async () => {
    // setTimeout truncates its delay to 32 bits, so half of "a decade" wraps
    // and fires on the next tick — which renews forever, a millisecond at a
    // time. A generous lease is not a Host mistake, so the cap lives here.
    const host = recorder({ lease: { token, expiresAt: '2099-01-01T00:00:00.000Z' } })
    const store = createEditingStore(host.port, 'wf_morning')
    store.open()
    await settle()

    await vi.advanceTimersByTimeAsync(60_000)
    expect(host.renewals).toBe(0)
    await vi.advanceTimersByTimeAsync(15 * 60_000)
    expect(host.renewals).toBe(1)
  })

  it('does not busy-loop on an unparseable expiry', async () => {
    const host = recorder({ lease: { token, expiresAt: 'whenever' } })
    const store = createEditingStore(host.port, 'wf_morning')
    store.open()
    await settle()

    await vi.advanceTimersByTimeAsync(5000)
    expect(host.renewals).toBeLessThanOrEqual(5)
  })

  it('stops renewing once disposed', async () => {
    const host = recorder({ lease: leaseFor(30) })
    const store = createEditingStore(host.port, 'wf_morning')
    store.open()
    await settle()
    store.dispose()

    await vi.advanceTimersByTimeAsync(60 * 60_000)
    expect(host.renewals).toBe(0)
  })
})

describe('ending the session', () => {
  const open = async () => {
    const host = recorder()
    const store = createEditingStore(host.port, 'wf_morning', { autosaveDelayMs: 500 })
    store.open()
    await settle()
    return { host, store }
  }

  it('publishes the current text, not the last text the Host accepted', async () => {
    // Autosave may still be pending. Publishing a version that silently omits
    // the user's last edit is worse than a rejected publish.
    const { host, store } = await open()
    store.apply(removeStep('s1'))
    await store.publish()

    expect(host.published).toHaveLength(1)
    expect(host.published[0]).not.toContain('id: s1')
  })

  it('hands the Host the token it minted, never one Hatua chose', async () => {
    // ADR-0005: exclusivity is only enforceable by whoever issues the
    // credential. The session carries a token it was given.
    const seen: EditToken[] = []
    const host = recorder()
    host.port.publish = async (given) => {
      seen.push(given)
      return { version: 5, publishedAt: '2026-01-01T00:00:00.000Z' }
    }
    const store = createEditingStore(host.port, 'wf_morning')
    store.open()
    await settle()
    await store.publish()

    expect(seen).toEqual([token])
  })

  it('stops autosave when the session ends, whichever way it ended', async () => {
    for (const end of ['release', 'discard'] as const) {
      const { host, store } = await open()
      store.apply(removeStep('s1'))
      await store[end]()

      await vi.advanceTimersByTimeAsync(10_000)
      expect(host.writes).toHaveLength(0)
    }
  })

  it('says the session ended rather than leaving an edit pending for ever', async () => {
    // Without this the state would sit at `pending` for ever: schedule() fires,
    // write() bails on the missing token, and nothing reports that the edit is
    // going nowhere — indistinguishable from "about to be written".
    const { store } = await open()
    await store.release()
    store.apply(removeStep('s1'))

    expect(ready(store).save).toMatchObject({ state: 'halted' })
    expect((ready(store).save as { error: Error }).error.message).toMatch(/session has ended/)
  })

  it('writes nothing more once the session ended, even if the document is edited again', async () => {
    // The Draft was released, discarded or promoted to an immutable Published
    // Version. There is nothing left to write to, and a write against the old
    // token would be refused anyway.
    const { host, store } = await open()
    await store.release()

    store.apply(removeStep('s1'))
    await vi.advanceTimersByTimeAsync(10_000)
    expect(host.writes).toHaveLength(0)
    // Still an editor, though — the document was not taken away.
    expect(ready(store).definition?.steps.map((s) => s.id)).toEqual(['s2', 's4'])
  })

  it('releases and discards through the token', async () => {
    const { host, store } = await open()
    await store.release()
    expect(host.released).toBe(1)

    const second = await open()
    await second.store.discard()
    expect(second.host.discarded).toBe(1)
  })

  it('refuses to publish before a Draft is open', async () => {
    const host = recorder()
    const store = createEditingStore(host.port, 'wf_morning')
    await expect(store.publish()).rejects.toThrow(/No Draft is open/)
  })
})
