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
import { setWorkflowName } from './workflow'

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

describe('a command that cannot be applied', () => {
  const open = async (yaml?: string) => {
    const host = recorder(yaml ? { yaml } : {})
    const store = createEditingStore(host.port, 'wf_morning')
    store.open()
    await settle()
    return { host, store }
  }

  /*
   * `steps:` written as a mapping. It parses, so the document opens; it does
   * not validate, which ADR-0001 requires the store to survive; and it is not a
   * list, so a command that splices into one cannot run.
   *
   * The failure this guards: a YAMLMap carries an `items` array too, so
   * recognising a sequence by shape accepts this — and the spliced node then
   * makes the whole document unserialisable, out of a `toString()` no caller
   * expects to fail.
   */
  const MAPPING = 'id: wf\nname: n\nversion: 1\nstatus: draft\nsteps:\n  first: nope\n'

  it('leaves a half-written document exactly as it was', async () => {
    const { store, host } = await open(MAPPING)
    const before = ready(store).text

    store.apply(addStep({ use: 'email.send' }, { index: 0 }))

    expect(ready(store).text).toBe(before)
    expect(ready(store).undoLabel).toBeNull()
    await vi.advanceTimersByTimeAsync(2000)
    expect(host.writes).toEqual([])
  })

  it('does not throw out of apply, because a click handler is what calls it', async () => {
    const { store } = await open(MAPPING)
    expect(() => store.apply(addStep({ use: 'email.send' }, { index: 0 }))).not.toThrow()
  })

  it('leaves the store usable, rather than poisoned for the rest of the session', async () => {
    // The document is read back on every commit, undo, redo and autosave, so
    // one command that left it unserialisable would take all of them with it
    // and only `reopen()` would recover.
    const { store, host } = await open(MAPPING)
    store.apply(addStep({ use: 'email.send' }, { index: 0 }))

    expect(() => store.undo()).not.toThrow()
    expect(() => ready(store).text).not.toThrow()

    // And a command that CAN be applied still works afterwards.
    store.apply(setWorkflowName('Renamed'))
    expect(ready(store).text).toContain('Renamed')
    await vi.advanceTimersByTimeAsync(2000)
    expect(host.writes).toHaveLength(1)
  })

  it('rolls the document back when a command breaks it after mutating', async () => {
    // Every command in this package does its lookups before its first mutation,
    // so it cannot half-apply — but the store must not depend on that, because
    // a Host may write its own EditCommand.
    const { store } = await open()
    const before = ready(store).text

    store.apply({
      label: 'Wreck it',
      apply(document) {
        const steps = document.ast.getIn(['steps'], true) as { items: unknown[] }
        steps.items.push(document.ast.createNode({ id: 's9', use: 'x' }))
        // A bare object where a node belongs: the AST takes it and the next
        // serialisation refuses it.
        ;(document.ast.contents as unknown as { items: unknown[] }).items.push({ nope: true })
      },
    })

    expect(ready(store).text).toBe(before)
    expect(ready(store).undoLabel).toBeNull()
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

  it('records nothing for a command that succeeds and changes nothing', async () => {
    // Dropping a Step onto the insert point directly above where it already
    // sits. The command finds its target and throws nothing — it simply has no
    // work to do — so there must be nothing to undo either.
    const { store } = await open()
    store.apply(moveStep('s1', { index: 0 }))

    expect(ready(store).text).toBe(SOURCE)
    expect(ready(store).undoLabel).toBeNull()
  })

  it('bounds the history, so a long session cannot grow without limit', async () => {
    // Every entry is a copy of the document's text, which is the whole cost of
    // undoing by restoring text rather than replaying an inverse.
    const { store } = await open()

    // 101 edits against a 100-deep stack: the first is pushed out.
    for (let n = 0; n < 101; n++) {
      store.apply(addStep({ use: `step.${n}` }, { index: 0 }))
    }
    expect(ready(store).undoLabel).toBe('Add step.100')

    for (let n = 0; n < 100; n++) store.undo()
    expect(ready(store).undoLabel).toBeNull()

    // Walked all the way back and still one edit from where it started,
    // because the oldest revision was dropped rather than the stack growing.
    expect(ready(store).text).not.toBe(SOURCE)
    expect(ready(store).definition?.steps).toHaveLength(4)
  } /*
   * 201 documents parsed and serialised, which is the point: the bound is
   * what stops it being unbounded. Vitest's default 5s covers it on a quiet
   * machine and does not cover it under coverage instrumentation with the
   * monorepo's suites running in parallel — the same margin `AUTOSAVED`
   * exists for, and the same reason. The number under test is the stack
   * depth, never the clock.
   */, 30_000)

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

  it('flush() waits out a write already open, rather than resolving having written nothing', async () => {
    /*
     * `write()` refuses to overlap, so a flush that returned early would hand
     * the caller a resolved promise, a cancelled timer and nothing written —
     * and flush's one caller is an unmount or a page about to close, which
     * then takes the open write's reschedule down with it. The edit is gone,
     * reported saved.
     */
    let release: (() => void) | undefined
    const host = recorder()
    host.port.saveDraft = async (_token, yaml) => {
      if (!release)
        await new Promise<void>((resolve) => {
          release = resolve
        })
      host.writes.push(yaml)
    }
    const store = createEditingStore(host.port, 'wf_morning', { autosaveDelayMs: 500 })
    store.open()
    await settle()

    store.apply(removeStep('s1'))
    await vi.advanceTimersByTimeAsync(500)
    store.apply(removeStep('s4'))

    const flushed = store.flush()
    release?.()
    await flushed
    store.dispose()

    expect(host.writes).toHaveLength(2)
    expect(host.writes[1]).not.toContain('id: s1')
    expect(host.writes[1]).not.toContain('id: s4')
  })

  it('reopens into a working autosave even if a Host never answered the last write', async () => {
    // A `saveDraft` that never settles would otherwise leave the in-flight
    // marker set for the life of the store: every later write returns at the
    // overlap guard, autosave is dead for good, and the panel sits at
    // `pending` with nothing reporting why.
    const host = recorder()
    host.port.saveDraft = async (_token, yaml) => {
      if (host.writes.length === 0 && !hung) {
        hung = true
        return new Promise<void>(() => {})
      }
      host.writes.push(yaml)
    }
    let hung = false

    const store = createEditingStore(host.port, 'wf_morning', { autosaveDelayMs: 500 })
    store.open()
    await settle()
    store.apply(removeStep('s1'))
    await vi.advanceTimersByTimeAsync(500)
    expect(host.writes).toHaveLength(0)

    store.reopen()
    await settle()
    store.apply(removeStep('s4'))
    await vi.advanceTimersByTimeAsync(500)

    expect(host.writes).toHaveLength(1)
  })

  it('ignores a write abandoned by a reopen, however late the Host answers it', async () => {
    /*
     * Reopening starts a fresh queue so a hung write cannot wedge autosave for
     * good — which means the abandoned write is no longer ordered against the
     * new session's. Its answer has to be inert: it belongs to a generation
     * that is over, and letting it report anything would overwrite what the
     * live session knows.
     */
    const gates: (() => void)[] = []
    const host = recorder()
    host.port.saveDraft = async (_token, yaml) => {
      if (gates.length === 0) {
        await new Promise<void>((resolve) => gates.push(resolve))
        host.writes.push(`stale:${yaml.length}`)
        return
      }
      host.writes.push(yaml)
    }
    const store = createEditingStore(host.port, 'wf_morning', { autosaveDelayMs: 500 })
    store.open()
    await settle()

    store.apply(removeStep('s1'))
    await vi.advanceTimersByTimeAsync(500)

    store.reopen()
    await settle()
    store.apply(removeStep('s4'))
    await vi.advanceTimersByTimeAsync(500)
    expect(ready(store).save).toEqual({ state: 'saved' })

    // The abandoned write finally answers.
    gates[0]?.()
    await settle()

    expect(ready(store).save).toEqual({ state: 'saved' })
    expect(host.writes.filter((w) => !w.startsWith('stale:'))).toHaveLength(1)
  })

  it('resolves a second concurrent flush only once its own write has been answered', async () => {
    // Both flushes wait on the same open write. Whichever resumes first starts
    // the next one — and a flush that merely returned at that point would
    // resolve with the write still open and the caller free to dispose out
    // from under it.
    let release: (() => void) | undefined
    const host = recorder()
    host.port.saveDraft = async (_token, yaml) => {
      if (!release)
        await new Promise<void>((resolve) => {
          release = resolve
        })
      host.writes.push(yaml)
    }
    const store = createEditingStore(host.port, 'wf_morning', { autosaveDelayMs: 500 })
    store.open()
    await settle()

    store.apply(removeStep('s1'))
    await vi.advanceTimersByTimeAsync(500)
    store.apply(removeStep('s4'))

    const first = store.flush()
    const second = store.flush()
    release?.()
    await Promise.all([first, second])

    // Everything the user did is with the Host by the time both resolve.
    expect(host.writes.at(-1)).not.toContain('id: s1')
    expect(host.writes.at(-1)).not.toContain('id: s4')
    expect(ready(store).save).toEqual({ state: 'saved' })
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
      await store[end]()

      store.apply(removeStep('s1'))
      await vi.advanceTimersByTimeAsync(10_000)
      expect(host.writes, end).toHaveLength(0)
    }
  })

  /*
   * There is no Save button (ADR-0005), so the only thing between the user's
   * last keystroke and the Host's copy is an 800ms timer — and every way of
   * ending a session cancels it. Release keeps the Draft for whoever picks it
   * up next, so the edit made inside that window has to reach it.
   */
  it('writes the edit still waiting out the autosave delay before releasing', async () => {
    const { host, store } = await open()
    store.apply(removeStep('s1'))
    expect(ready(store).save).toEqual({ state: 'pending' })

    await store.release()

    expect(host.writes).toHaveLength(1)
    expect(host.writes[0]).not.toContain('id: s1')
    expect(host.released).toBe(1)
  })

  it('does not write before discarding, because the Draft is being thrown away', async () => {
    // The only possible effect would be to lose a race with the delete.
    const { host, store } = await open()
    store.apply(removeStep('s1'))
    await store.discard()

    expect(host.writes).toHaveLength(0)
    expect(host.discarded).toBe(1)
  })

  it('gets the last edit out when the store is disposed', async () => {
    // <HatuaProvider> disposes on a `workflowId` change, a swapped port, or the
    // Host unmounting the designer on a route change. Fire and forget, because
    // an effect cleanup cannot await — and there is nobody left to report to.
    const { host, store } = await open()
    store.apply(removeStep('s1'))

    store.dispose()
    await settle()

    expect(host.writes).toHaveLength(1)
    expect(host.writes[0]).not.toContain('id: s1')
  })

  it('writes nothing on dispose when the Host is already level with the document', async () => {
    const { host, store } = await open()
    store.dispose()
    await settle()
    expect(host.writes).toHaveLength(0)
  })

  it('writes nothing on dispose once autosave has halted', async () => {
    // Halted means the Host said no. Retrying on the way out would hammer a
    // Host that has already refused, which is what ADR-0005 forbids.
    const host = recorder({ rejectSave: new Error('Your lease expired.') })
    const store = createEditingStore(host.port, 'wf_morning', { autosaveDelayMs: 500 })
    store.open()
    await settle()

    store.apply(removeStep('s1'))
    await vi.advanceTimersByTimeAsync(2000)
    expect(ready(store).save).toMatchObject({ state: 'halted' })

    store.dispose()
    await settle()
    expect(host.writes).toHaveLength(0)
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

  /*
   * ADR-0005 puts the conflict check at publish and nowhere else — "the Host
   * rejects the whole operation if the version the draft branched from is no
   * longer the live one" — so a refused publish is the documented path, not an
   * exotic one. Ending the session before the Host has answered throws the
   * token away while the Host still considers the claim live: the user is told
   * the publish failed, and the Draft in front of them is no longer saved
   * anywhere, with nothing on screen saying so.
   */
  it('keeps the session alive when the Host refuses the publish', async () => {
    const host = recorder()
    host.port.publish = async () => {
      throw new Error('Someone else published v5 while you were editing.')
    }
    const store = createEditingStore(host.port, 'wf_morning', { autosaveDelayMs: 500 })
    store.open()
    await settle()

    await expect(store.publish()).rejects.toThrow(/Someone else published/)

    // Still editing, and still being saved.
    store.apply(removeStep('s1'))
    await vi.advanceTimersByTimeAsync(2000)
    expect(host.writes).toHaveLength(1)
    expect(ready(store).save).toEqual({ state: 'saved' })
  })

  it('renews the lease again after a refused publish, so the claim does not lapse', async () => {
    const host = recorder({ lease: leaseFor(10) })
    host.port.publish = async () => {
      throw new Error('rejected')
    }
    const store = createEditingStore(host.port, 'wf_morning')
    store.open()
    await settle()

    await expect(store.publish()).rejects.toThrow()
    await vi.advanceTimersByTimeAsync(6 * 60_000)
    expect(host.renewals).toBeGreaterThan(0)
  })

  it('does not leave a pending write promised for ever when the session ends', async () => {
    // finish() cancels the timer and drops the token, so a write scheduled
    // inside the autosave window can never happen — and a snapshot still
    // reading `pending` is promising one that nothing can deliver. Discard,
    // because release writes the pending edit out rather than abandoning it.
    const { store } = await open()
    store.apply(removeStep('s1'))
    expect(ready(store).save).toEqual({ state: 'pending' })

    await store.discard()

    expect(ready(store).save).toMatchObject({ state: 'halted' })
    await vi.advanceTimersByTimeAsync(10_000)
    expect(ready(store).save).toMatchObject({ state: 'halted' })
  })

  it('leaves a saved session saved when it ends, rather than reporting a halt', async () => {
    const { store } = await open()
    await store.release()
    expect(ready(store).save).toEqual({ state: 'saved' })
  })
})
