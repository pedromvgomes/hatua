import type { WorkflowDocument } from '@hatua/document'
import type { Diagnostic } from '@hatua/model'
import { regionsOf } from '@hatua/model'
import type { Step } from '@hatua/schema'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sequence } from './command'
import { createEditingStore, type EditingSnapshot, PublishBlocked } from './editing'
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
    use: component.email.fetch
    name: "Fetch mail"
    with:
      folder: INBOX      # not Archive
  - id: s2
    use: core.fork
    branches:
      - label: Urgent
        when: "{{ steps.s1.count > 10 }}"
        steps:
          - id: s3
            use: component.email.send
      - label: Otherwise
        steps: []
  - id: s4
    use: core.for_each
    steps:
      - id: s5
        use: component.agent.classify
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

    store.apply(removeStep({ board: null, id: 's1' }))
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
    store.apply(removeStep({ board: null, id: 's1' }))
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

    store.apply(addStep({ use: 'component.email.send' }, { index: 0 }))

    expect(ready(store).text).toBe(before)
    expect(ready(store).undoLabel).toBeNull()
    await vi.advanceTimersByTimeAsync(2000)
    expect(host.writes).toEqual([])
  })

  it('does not throw out of apply, because a click handler is what calls it', async () => {
    const { store } = await open(MAPPING)
    expect(() => store.apply(addStep({ use: 'component.email.send' }, { index: 0 }))).not.toThrow()
  })

  it('leaves the store usable, rather than poisoned for the rest of the session', async () => {
    // The document is read back on every commit, undo, redo and autosave, so
    // one command that left it unserialisable would take all of them with it
    // and only `reopen()` would recover.
    const { store, host } = await open(MAPPING)
    store.apply(addStep({ use: 'component.email.send' }, { index: 0 }))

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

/**
 * The invariant under every command there is, and every command written later.
 *
 * Inheriting a document that does not project is a state this store is built to
 * hold — ADR-0001 makes the text the source of truth, and `a document that does
 * not project` above covers it. MANUFACTURING one is a different thing: every
 * surface in the product reads `definition`, so a command that breaks the
 * projection empties the canvas, the side panel and the step editor at once and
 * leaves the user nothing to click on to undo it.
 */
describe('a command may not break the projection', () => {
  const open = async (yaml?: string) => {
    const host = recorder(yaml ? { yaml } : {})
    const store = createEditingStore(host.port, 'wf_morning')
    store.open()
    await settle()
    return { host, store }
  }

  /** Writes a key the schema's `identifier` refuses, exactly as a name box would. */
  const writeKey = (key: string) => ({
    label: 'Rename',
    apply(document: WorkflowDocument) {
      document.ast.setIn(['vars', 0, 'key'], key)
    },
  })

  const WITH_VAR = `id: wf_morning\nname: n\nversion: 1\nstatus: draft\nvars:\n  - key: digest_to\n    t: text\n    value: ""\nsteps: []\n`

  it('refuses the edit and leaves the text as it was', async () => {
    const { store, host } = await open(WITH_VAR)
    const before = ready(store).text
    expect(ready(store).definition).not.toBeNull()

    store.apply(writeKey('Variable 1'))

    expect(ready(store).text).toBe(before)
    expect(ready(store).definition).not.toBeNull()
    // Nothing reached the undo stack, so there is nothing to undo back out of.
    expect(ready(store).undoLabel).toBeNull()
    await vi.advanceTimersByTimeAsync(2000)
    expect(host.writes).toEqual([])
  })

  /*
   * The snapshot publishes `workflow.document` BY REFERENCE, and a refused
   * command has already mutated that object. Restoring the store's own handle
   * is not enough: until the next successful command, a reader holding the
   * snapshot is holding the tree the store threw away — and `views/Build` reads
   * exactly that to work out where a Component appends.
   */
  it('publishes the restored document, not the one the refused command mutated', async () => {
    const { store } = await open(WITH_VAR)

    store.apply(writeKey('Variable 1'))

    const held = ready(store).document
    expect(held.toString()).toBe(ready(store).text)
    expect(held.validate().success).toBe(true)
  })

  it('does the same for a command that throws, which restores by the same path', async () => {
    const { store } = await open(WITH_VAR)

    store.apply({
      label: 'Half an edit',
      apply(document: WorkflowDocument) {
        document.ast.setIn(['vars', 0, 'key'], 'part_way')
        throw new Error('gave up')
      },
    })

    const held = ready(store).document
    expect(held.toString()).toBe(ready(store).text)
    expect(held.toString()).not.toContain('part_way')
  })

  it('lets the same command through when the name is one the schema holds', async () => {
    const { store } = await open(WITH_VAR)
    store.apply(writeKey('digest_cc'))

    expect(ready(store).text).toContain('key: digest_cc')
    expect(ready(store).definition).not.toBeNull()
  })

  /*
   * Only a document that projected is protected. One that did not is the user's
   * file being wrong, and refusing every edit to it would leave nothing able to
   * fix it — which is the opposite of what ADR-0001 asks for.
   */
  it('does not judge a document that did not project to begin with', async () => {
    const HALF =
      'id: wf\nname: n\nversion: 1\nstatus: draft\nsteps:\n  - use: component.email.send\n'
    const { store } = await open(HALF)
    expect(ready(store).definition).toBeNull()
    const before = ready(store).text

    store.apply(setWorkflowName('Renamed'))

    expect(ready(store).text).not.toBe(before)
    expect(ready(store).text).toContain('Renamed')
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
    store.apply(addStep({ use: 'component.email.send', name: 'Reply' }, { index: 1 }))

    const steps = ready(store).definition?.steps ?? []
    expect(steps.map((step) => step.id)).toEqual(['s1', 's6', 's2', 's4'])
    expect(steps[1]?.use).toBe('component.email.send')
  })

  /*
   * A container added from the catalogue can be filled in.
   *
   * `regionsOf` yields a region only where the document carries the key, and the
   * map draws only the regions it is yielded — so a `core.try` written as `id`
   * and `use` alone has no band, no `+` inside it and no way in. It is a card
   * that can never become a try. The keys are what make it reachable, and they
   * are written when the Step is.
   */
  it('gives a core.try its two regions, so there is somewhere to put a Step', async () => {
    const { store } = await open()
    store.apply(addStep({ use: 'core.try', name: 'Guarded' }, { index: 0 }))

    const added = ready(store).definition?.steps[0]
    expect(added?.use).toBe('core.try')
    expect(added?.steps).toEqual([])
    expect(added?.handler).toEqual([])
    expect([...regionsOf(added as Step)].map((region) => region.keyword)).toEqual([
      'attempt',
      'on failure',
    ])
  })

  it('gives a loop its body, and gives an ordinary Component no regions at all', async () => {
    const { store } = await open()
    store.apply(addStep({ use: 'core.for_each' }, { index: 0 }))
    store.apply(addStep({ use: 'component.email.send' }, { index: 0 }))

    const [plain, loop] = ready(store).definition?.steps ?? []
    expect(loop?.steps).toEqual([])
    expect(loop?.handler).toBeUndefined()
    // A `steps:` on a Step that nests nothing is a region the map would draw
    // and no runner would enter.
    expect(plain?.steps).toBeUndefined()
    expect([...regionsOf(plain as Step)]).toEqual([])
  })

  /*
   * A Branch is not an empty list: it carries a label and a condition, so a
   * Fork born with `branches: []` is the same unfillable card a `core.try` with
   * no keys is. Two of them, because CONTEXT.md defines a Fork as holding two
   * or more — and a condition fork, because `when: ''` is a condition still to
   * write while its absence on the last Branch is the fallback.
   */
  it('gives a core.fork two Branches, so a Fork is something a Step can go into', async () => {
    const { store } = await open()
    store.apply(addStep({ use: 'core.fork', name: 'Which way' }, { index: 0 }))

    const added = ready(store).definition?.steps[0]
    expect(added?.branches?.map((branch) => branch.label)).toEqual(['Condition', 'Otherwise'])
    expect(added?.branches?.map((branch) => branch.when)).toEqual(['', undefined])
    for (const branch of added?.branches ?? []) expect(branch.steps).toEqual([])
    expect([...regionsOf(added as Step)].map((region) => region.keyword)).toEqual(['if', 'else'])
  })

  it('appends when the index is past the end', async () => {
    const { store } = await open()
    store.apply(addStep({ use: 'component.email.send' }, { index: 99 }))
    expect(ready(store).definition?.steps.at(-1)?.id).toBe('s6')
  })

  it('adds into a Branch, creating the sequence an empty one does not have', async () => {
    // "Otherwise" is written `steps: []` in the fixture; a Branch a user has
    // not filled in may have no `steps:` key at all, and the first drop into it
    // has to work either way.
    const { store } = await open()
    store.apply(
      addStep({ use: 'component.email.send' }, { parentId: 's2', branchIndex: 1, index: 0 }),
    )

    const fork = ready(store).definition?.steps.find((step) => step.id === 's2')
    expect(fork?.branches?.[1]?.steps.map((step) => step.id)).toEqual(['s6'])
  })

  it('adds into a loop’s own steps, which take no branch wrapper', async () => {
    const { store } = await open()
    store.apply(addStep({ use: 'component.email.send' }, { parentId: 's4', index: 1 }))

    const loop = ready(store).definition?.steps.find((step) => step.id === 's4')
    expect(loop?.steps?.map((step) => step.id)).toEqual(['s5', 's6'])
  })

  it('removes a Step, and a container takes its subtree with it', async () => {
    const { store } = await open()
    store.apply(removeStep({ board: null, id: 's2' }))

    const steps = ready(store).definition?.steps ?? []
    expect(steps.map((step) => step.id)).toEqual(['s1', 's4'])
    expect(ready(store).text).not.toContain('s3')
  })

  it('removes a nested Step without touching its siblings', async () => {
    const { store } = await open()
    store.apply(removeStep({ board: null, id: 's3' }))

    const fork = ready(store).definition?.steps.find((step) => step.id === 's2')
    expect(fork?.branches?.[0]?.steps).toEqual([])
    expect(fork?.branches?.[1]?.label).toBe('Otherwise')
  })

  it('moves a Step within its own list without overshooting', async () => {
    // Detaching shifts everything after it down one, so "move s1 to index 2"
    // means "after s2" and lands at index 1 once the list is a step shorter.
    const { store } = await open()
    store.apply(moveStep({ board: null, id: 's1' }, { index: 2 }))
    expect(ready(store).definition?.steps.map((step) => step.id)).toEqual(['s2', 's1', 's4'])
  })

  it('moves a Step out of a Branch and up to the root', async () => {
    const { store } = await open()
    store.apply(moveStep({ board: null, id: 's3' }, { index: 0 }))

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
    store.apply(moveStep({ board: null, id: 's1' }, { parentId: 's2', branchIndex: 1, index: 0 }))

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
    store.apply(moveStep({ board: null, id: 's1' }, { parentId: 's4', index: 0 }))

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

    store.apply(removeStep({ board: null, id: 's2' }))
    expect(ready(store).text).toContain('id: s1')
    expect(ready(store).text).not.toContain('id: s2')
  })

  it('refuses to move a container inside itself', async () => {
    // Otherwise the subtree is detached and spliced into a sequence that lives
    // inside the detached node: the Step and everything under it disappear from
    // the document with no error anywhere.
    const { store } = await open()
    const before = ready(store).text
    store.apply(moveStep({ board: null, id: 's2' }, { parentId: 's2', branchIndex: 0, index: 0 }))
    expect(ready(store).text).toBe(before)
  })

  it('treats a command that cannot find its Step as a no-op, not half an edit', async () => {
    const { store } = await open()
    const before = ready(store).text
    store.apply(removeStep({ board: null, id: 's99' }))

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
    store.apply(addStep({ use: 'component.email.send', name: 'Reply' }, { index: 1 }))
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
    expect(ready(store).text).toContain('when: "{{ steps.s1.count > 10 }}"')
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

    store.apply(moveStep({ board: null, id: 's2' }, { index: 0 }))
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
    store.apply(removeStep({ board: null, id: 's2' }))
    expect(ready(store).text).not.toBe(SOURCE)

    store.undo()
    expect(ready(store).text).toBe(SOURCE)
  })

  /*
   * What the canvas's selection bar applies when it removes a Segment. Left as
   * separate commands, the first undo puts half a selection back — a document
   * state nothing on screen explains, and the reason `sequence` exists.
   */
  it('undoes a sequence of removals as one change, not one per member', async () => {
    const { store } = await open()
    store.apply(
      sequence(
        'Remove 2 Steps',
        removeStep({ board: null, id: 's1' }),
        removeStep({ board: null, id: 's2' }),
      ),
    )
    // Both gone, so the assertions below are about one undo of two removals
    // rather than one undo of one.
    expect(ready(store).text).not.toContain('id: s1')
    expect(ready(store).text).not.toContain('id: s2')
    expect(ready(store).undoLabel).toBe('Remove 2 Steps')

    store.undo()
    // Both back, and the stack empty: two entries would leave one removal
    // standing and something still to undo.
    expect(ready(store).text).toBe(SOURCE)
    expect(ready(store).undoLabel).toBeNull()
  })

  it('names what it would undo, so a control can label itself', async () => {
    const { store } = await open()
    expect(ready(store).undoLabel).toBeNull()

    store.apply(addStep({ use: 'component.email.send', name: 'Reply' }, { index: 0 }))
    expect(ready(store).undoLabel).toBe('Add Reply')
    expect(ready(store).redoLabel).toBeNull()

    store.undo()
    expect(ready(store).undoLabel).toBeNull()
    expect(ready(store).redoLabel).toBe('Add Reply')
  })

  it('redoes what it undid', async () => {
    const { store } = await open()
    store.apply(removeStep({ board: null, id: 's1' }))
    const after = ready(store).text

    store.undo()
    store.redo()
    expect(ready(store).text).toBe(after)
  })

  it('walks several edits back in order', async () => {
    const { store } = await open()
    store.apply(removeStep({ board: null, id: 's1' }))
    store.apply(removeStep({ board: null, id: 's4' }))
    expect(ready(store).definition?.steps.map((step) => step.id)).toEqual(['s2'])

    store.undo()
    expect(ready(store).definition?.steps.map((step) => step.id)).toEqual(['s2', 's4'])
    store.undo()
    expect(ready(store).text).toBe(SOURCE)
  })

  it('drops the redo stack once a new edit makes it unreachable', async () => {
    const { store } = await open()
    store.apply(removeStep({ board: null, id: 's1' }))
    store.undo()
    expect(ready(store).redoLabel).not.toBeNull()

    store.apply(removeStep({ board: null, id: 's4' }))
    expect(ready(store).redoLabel).toBeNull()
  })

  it('records nothing for a command that succeeds and changes nothing', async () => {
    // Dropping a Step onto the insert point directly above where it already
    // sits. The command finds its target and throws nothing — it simply has no
    // work to do — so there must be nothing to undo either.
    const { store } = await open()
    store.apply(moveStep({ board: null, id: 's1' }, { index: 0 }))

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
    store.apply(removeStep({ board: null, id: 's1' }))
    expect(ready(store).save).toEqual({ state: 'pending' })
    expect(host.writes).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(500)
    expect(host.writes).toHaveLength(1)
    expect(ready(store).save).toEqual({ state: 'saved' })
  })

  it('writes the document’s text, not a re-serialisation of the projection', async () => {
    const { host, store } = await open()
    store.apply(removeStep({ board: null, id: 's1' }))
    await vi.advanceTimersByTimeAsync(500)
    expect(host.writes[0]).toContain('# Triage the overnight inbox before standup.')
  })

  it('coalesces a burst of edits into one write', async () => {
    const { host, store } = await open()
    store.apply(removeStep({ board: null, id: 's1' }))
    await vi.advanceTimersByTimeAsync(200)
    store.apply(removeStep({ board: null, id: 's4' }))
    await vi.advanceTimersByTimeAsync(200)
    expect(host.writes).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(500)
    expect(host.writes).toHaveLength(1)
  })

  it('writes an undo too, because undoing is an edit like any other', async () => {
    const { host, store } = await open()
    store.apply(removeStep({ board: null, id: 's1' }))
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
    store.apply(removeStep({ board: null, id: 's1' }))
    await vi.advanceTimersByTimeAsync(200)
    store.undo()

    await vi.advanceTimersByTimeAsync(500)
    expect(host.writes).toHaveLength(0)
    expect(ready(store).save).toEqual({ state: 'saved' })
  })

  it('does not write when nothing changed', async () => {
    const { host, store } = await open()
    store.apply(removeStep({ board: null, id: 's99' }))
    await vi.advanceTimersByTimeAsync(2000)
    expect(host.writes).toHaveLength(0)
  })

  it('flush() writes now rather than waiting the delay out', async () => {
    const { host, store } = await open()
    store.apply(removeStep({ board: null, id: 's1' }))
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
      store.apply(removeStep({ board: null, id: 's1' }))
      await vi.advanceTimersByTimeAsync(500)

      expect(ready(store).save).toEqual({ state: 'halted', error: new Error('Lease expired.') })

      store.apply(removeStep({ board: null, id: 's4' }))
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

      store.apply(removeStep({ board: null, id: 's1' }))
      await vi.advanceTimersByTimeAsync(60_000)
      expect(attempts).toHaveLength(1)
    })

    it('keeps the in-memory document, and keeps it editable', async () => {
      const { store } = await open({ rejectSave: new Error('Lease expired.') })
      store.apply(removeStep({ board: null, id: 's1' }))
      await vi.advanceTimersByTimeAsync(500)

      // Not reverted to what the Host last accepted...
      expect(ready(store).definition?.steps.map((s) => s.id)).toEqual(['s2', 's4'])

      // ...and still an editor, not a read-only view of lost work.
      store.apply(removeStep({ board: null, id: 's4' }))
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

    store.apply(removeStep({ board: null, id: 's1' }))
    await vi.advanceTimersByTimeAsync(500)
    store.apply(removeStep({ board: null, id: 's4' }))

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
    store.apply(removeStep({ board: null, id: 's1' }))
    await vi.advanceTimersByTimeAsync(500)
    expect(host.writes).toHaveLength(0)

    store.reopen()
    await settle()
    store.apply(removeStep({ board: null, id: 's4' }))
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

    store.apply(removeStep({ board: null, id: 's1' }))
    await vi.advanceTimersByTimeAsync(500)

    store.reopen()
    await settle()
    store.apply(removeStep({ board: null, id: 's4' }))
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

    store.apply(removeStep({ board: null, id: 's1' }))
    await vi.advanceTimersByTimeAsync(500)
    store.apply(removeStep({ board: null, id: 's4' }))

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

    store.apply(removeStep({ board: null, id: 's1' }))
    await vi.advanceTimersByTimeAsync(500)
    store.apply(removeStep({ board: null, id: 's4' }))
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

    store.apply(removeStep({ board: null, id: 's1' }))
    await vi.advanceTimersByTimeAsync(500)
    expect(ready(store).save).toEqual({ state: 'saving' })

    store.apply(removeStep({ board: null, id: 's4' }))
    release?.()
    await settle()
    expect(ready(store).save).toEqual({ state: 'pending' })

    await vi.advanceTimersByTimeAsync(500)
    expect(host.writes).toHaveLength(2)
  })
})

describe('a Host that rotates the token on renewal', () => {
  /*
   * `Lease` carries a token as well as an expiry, which is only worth carrying
   * if a Host may hand back a new one. Reading only the clock leaves this store
   * writing with a credential the Host no longer honours: every save refused,
   * then a halt, and a publish spending a claim that is not the live one.
   */
  it('writes with the token the renewal handed back', async () => {
    const rotated = 'tok_2' as EditToken
    const host = recorder({ lease: leaseFor(0.05) })
    const seen: EditToken[] = []
    host.port.renewLease = async () => ({ token: rotated, expiresAt: leaseFor(30).expiresAt })
    host.port.saveDraft = async (given) => {
      seen.push(given)
    }

    const store = createEditingStore(host.port, 'wf_morning', { autosaveDelayMs: 100 })
    store.open()
    await settle()
    await vi.advanceTimersByTimeAsync(2000)

    store.apply(removeStep({ board: null, id: 's1' }))
    await vi.advanceTimersByTimeAsync(200)

    expect(seen).toEqual([rotated])
  })
})

describe('a token rotated while an ending is in flight', () => {
  const rotated = 'tok_2' as EditToken

  /*
   * A renewal can land inside the gate's wait and hand back a new token, and it
   * does not bump the generation — so the guard after the wait says nothing
   * about it. Spending the credential captured before the wait gets the publish
   * refused for a reason the user can neither see nor act on.
   */
  it('publishes on the token the renewal handed back', async () => {
    let answer: (found: Diagnostic[]) => void = () => {}
    const pending = new Promise<Diagnostic[]>((resolve) => {
      answer = resolve
    })
    const spent: EditToken[] = []
    const host = recorder({ lease: leaseFor(0.05) })
    host.port.renewLease = async () => ({ token: rotated, expiresAt: leaseFor(30).expiresAt })
    host.port.publish = async (given): Promise<PublishedVersion> => {
      spent.push(given)
      return { version: 5, publishedAt: '2026-01-01T00:00:00.000Z' }
    }

    const store = createEditingStore(host.port, 'wf_morning', {
      autosaveDelayMs: 100,
      gate: { blockers: () => pending },
    })
    store.open()
    await settle()

    const attempt = store.publish()
    await settle()
    // The renewal fires inside the wait.
    await vi.advanceTimersByTimeAsync(2000)

    answer([])
    await attempt
    expect(spent).toEqual([rotated])
  })

  it('releases on it too, because the last write is an unbounded wait', async () => {
    let land: () => void = () => {}
    const spent: EditToken[] = []
    const host = recorder({ lease: leaseFor(0.05) })
    host.port.renewLease = async () => ({ token: rotated, expiresAt: leaseFor(30).expiresAt })
    host.port.saveDraft = () =>
      new Promise<void>((resolve) => {
        land = resolve
      })
    host.port.releaseDraft = async (given) => {
      spent.push(given)
    }

    const store = createEditingStore(host.port, 'wf_morning', { autosaveDelayMs: 100 })
    store.open()
    await settle()
    store.apply(removeStep({ board: null, id: 's1' }))

    const ending = store.release()
    await vi.advanceTimersByTimeAsync(2000)
    land()
    await ending

    expect(spent).toEqual([rotated])
  })
})

describe('a renewal that answers with less than a full lease', () => {
  /*
   * Nothing read the renewal's token before, so a Host answering with the expiry
   * alone was correct and may still be. Taking `undefined` from it ends a
   * session whose lease the Host considers perfectly good.
   */
  it('keeps the token it holds when the Host sends none back', async () => {
    const host = recorder({ lease: leaseFor(0.05) })
    host.port.renewLease = async () => ({ expiresAt: leaseFor(30).expiresAt }) as unknown as Lease

    const store = createEditingStore(host.port, 'wf_morning', { autosaveDelayMs: 100 })
    store.open()
    await settle()
    await vi.advanceTimersByTimeAsync(2000)

    expect(ready(store).claimed).toBe(true)
    store.apply(removeStep({ board: null, id: 's1' }))
    await vi.advanceTimersByTimeAsync(200)
    expect(host.writes).toHaveLength(1)
  })
})

describe('two renewals in the air at once', () => {
  /*
   * The armed timer can fire while a press has already asked, or a press can
   * land twice — and against a Host that ROTATES the token, whichever response
   * arrives LAST wins the assignment. The older one then installs a credential
   * the Host has already superseded: every write refused, and the three endings
   * spending a claim that is not live.
   */
  it('keeps the token from the renewal that was asked for last', async () => {
    const answers: ((lease: Lease) => void)[] = []
    let refuseWrite = true
    const written: EditToken[] = []
    const host = recorder({ lease: leaseFor(30) })
    host.port.renewLease = () =>
      new Promise<Lease>((resolve) => {
        answers.push(resolve)
      })
    host.port.saveDraft = async (given) => {
      if (refuseWrite) throw new Error('The workflow service is unreachable.')
      written.push(given)
    }

    const store = createEditingStore(host.port, 'wf_morning', { autosaveDelayMs: 100 })
    store.open()
    await settle()

    // Halted by a refused write, which leaves the armed renewal alone.
    store.apply(removeStep({ board: null, id: 's1' }))
    await vi.advanceTimersByTimeAsync(200)
    expect(ready(store).save).toMatchObject({ state: 'halted' })

    // The armed renewal fires and hangs...
    await vi.advanceTimersByTimeAsync(16 * 60_000)
    // ...and the reader presses "try again", which asks a second time.
    store.resumeSaving()
    await settle()
    expect(answers).toHaveLength(2)

    refuseWrite = false
    // The newer answers first, the older last.
    answers[1]?.({ token: 'tok_new' as EditToken, expiresAt: leaseFor(30).expiresAt })
    await settle()
    answers[0]?.({ token: 'tok_old' as EditToken, expiresAt: leaseFor(30).expiresAt })
    await settle()

    await vi.advanceTimersByTimeAsync(200)
    expect(written).toEqual(['tok_new'])
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
    store.apply(removeStep({ board: null, id: 's1' }))
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

      store.apply(removeStep({ board: null, id: 's1' }))
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
    store.apply(removeStep({ board: null, id: 's1' }))
    expect(ready(store).save).toEqual({ state: 'pending' })

    await store.release()

    expect(host.writes).toHaveLength(1)
    expect(host.writes[0]).not.toContain('id: s1')
    expect(host.released).toBe(1)
  })

  /*
   * `write()` cannot reject — `attempt()` turns a refused `saveDraft` into a halt
   * and returns normally — so awaiting it says the attempt is over, not that it
   * worked. Releasing anyway hands the Draft on WITHOUT the edit that was in
   * flight and reports a clean ending, with nothing on screen to say otherwise:
   * the halt is drawn against a claim, and the claim would be gone.
   */
  it('refuses to release a Draft whose last edit never reached the Host', async () => {
    const host = recorder({ rejectSave: new Error('Your lease on this workflow expired.') })
    const store = createEditingStore(host.port, 'wf_morning', { autosaveDelayMs: 100 })
    store.open()
    await settle()
    store.apply(removeStep({ board: null, id: 's1' }))

    await expect(store.release()).rejects.toThrow(/lease/)

    expect(host.released).toBe(0)
    // The claim is kept, so the halt is still on screen and still resumable.
    expect(ready(store).claimed).toBe(true)
    expect(ready(store).save).toMatchObject({ state: 'halted' })
  })

  /*
   * `attempt()` returns immediately when the store is already halted, so the
   * write a Release awaits is a no-op and the halt stands whether or not
   * anything was pending. Judged on the halt alone, a Release pressed on a clean
   * document after a refused RENEWAL — the commonest halt, and one that loses
   * nothing — is refused for ever, which is the opposite of handing the Draft
   * back.
   */
  it('releases a clean Draft even though autosave is halted', async () => {
    const host = recorder({ lease: leaseFor(0.05) })
    host.port.renewLease = async () => {
      throw new Error('Your lease on this workflow expired.')
    }
    const store = createEditingStore(host.port, 'wf_morning', { autosaveDelayMs: 100 })
    store.open()
    await settle()

    // Nothing typed, and the renewal is refused.
    await vi.advanceTimersByTimeAsync(2000)
    expect(ready(store).save).toMatchObject({ state: 'halted' })

    await store.release()
    expect(host.released).toBe(1)
    expect(ready(store).claimed).toBe(false)
  })

  /*
   * A halt is raised by a refused RENEWAL too, and that fires on a timer — so a
   * write that succeeded inside the same round trip as a refused renewal was
   * reported as lost, refusing a release whose Draft is on the Host intact and
   * leaving Discard as the only way out of it.
   */
  it('releases when the write landed, even though a renewal was refused alongside it', async () => {
    const host = recorder({ lease: leaseFor(0.05) })
    host.port.renewLease = async () => {
      throw new Error('Your lease on this workflow expired.')
    }
    const store = createEditingStore(host.port, 'wf_morning', { autosaveDelayMs: 100 })
    store.open()
    await settle()

    store.apply(removeStep({ board: null, id: 's1' }))
    // The write goes out and lands; the renewal is refused meanwhile.
    await vi.advanceTimersByTimeAsync(2000)
    expect(host.writes).toHaveLength(1)
    expect(ready(store).save).toMatchObject({ state: 'halted' })

    await store.release()
    expect(host.released).toBe(1)
  })

  /*
   * A document is dirty again the moment somebody types during the write, which
   * is a healthy store with another save already scheduled — not an edit that
   * went nowhere. Judged on that, a release refused with "could not be saved"
   * over a write that had just succeeded, and pointed the reader at a control
   * that is only drawn when saving has stopped.
   */
  it('releases when its write landed and the reader kept typing through it', async () => {
    let land: () => void = () => {}
    const host = recorder()
    host.port.saveDraft = async (_token, text) => {
      host.writes.push(text)
      await new Promise<void>((resolve) => {
        land = resolve
      })
    }

    const store = createEditingStore(host.port, 'wf_morning', { autosaveDelayMs: 100 })
    store.open()
    await settle()
    store.apply(removeStep({ board: null, id: 's1' }))

    const ending = store.release()
    await vi.advanceTimersByTimeAsync(200)
    // Typed while that write is still in the air.
    store.apply(removeStep({ board: null, id: 's4' }))
    land()

    await ending
    expect(host.released).toBe(1)
  })

  it('does not write before discarding, because the Draft is being thrown away', async () => {
    // The only possible effect would be to lose a race with the delete.
    const { host, store } = await open()
    store.apply(removeStep({ board: null, id: 's1' }))
    await store.discard()

    expect(host.writes).toHaveLength(0)
    expect(host.discarded).toBe(1)
  })

  it('gets the last edit out when the store is disposed', async () => {
    // <HatuaProvider> disposes on a `workflowId` change, a swapped port, or the
    // Host unmounting the designer on a route change. Fire and forget, because
    // an effect cleanup cannot await — and there is nobody left to report to.
    const { host, store } = await open()
    store.apply(removeStep({ board: null, id: 's1' }))

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

    store.apply(removeStep({ board: null, id: 's1' }))
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
    store.apply(removeStep({ board: null, id: 's1' }))

    expect(ready(store).save).toMatchObject({ state: 'halted' })
    expect((ready(store).save as { error: Error }).error.message).toMatch(/session has ended/)
  })

  it('writes nothing more once the session ended, even if the document is edited again', async () => {
    // The Draft was released, discarded or promoted to an immutable Published
    // Version. There is nothing left to write to, and a write against the old
    // token would be refused anyway.
    const { host, store } = await open()
    await store.release()

    store.apply(removeStep({ board: null, id: 's1' }))
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
    store.apply(removeStep({ board: null, id: 's1' }))
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
    store.apply(removeStep({ board: null, id: 's1' }))
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

describe('the publish gate', () => {
  const blocker = (message: string): Diagnostic => ({
    code: 'FIELD_REQUIRED',
    message,
    blocks: 'publish',
    stepId: 's1',
  })

  const opened = async (options: Parameters<typeof createEditingStore>[2] = {}) => {
    const host = recorder()
    const store = createEditingStore(host.port, 'wf_morning', {
      autosaveDelayMs: 500,
      ...options,
    })
    store.open()
    await settle()
    return { host, store }
  }

  /*
   * The floor. It asks nothing and needs nothing wired, which is the point:
   * ADR-0023 puts it here rather than in whatever drew the button precisely so
   * a Host that builds this store by hand and mounts no toolbar still cannot
   * promote something that is not a Workflow Definition.
   */
  it('refuses a document that does not project, with no gate in sight', async () => {
    const host = recorder({ yaml: 'name: half written\n' })
    const store = createEditingStore(host.port, 'wf_morning')
    store.open()
    await settle()

    await expect(store.publish()).rejects.toBeInstanceOf(PublishBlocked)
    expect(host.published).toHaveLength(0)
  })

  it('carries no diagnostics for that, because there is nothing to attach one to', async () => {
    const host = recorder({ yaml: 'name: half written\n' })
    const store = createEditingStore(host.port, 'wf_morning')
    store.open()
    await settle()

    const refusal = await store.publish().catch((error: unknown) => error)
    expect(refusal).toBeInstanceOf(PublishBlocked)
    expect((refusal as PublishBlocked).diagnostics).toEqual([])
    expect((refusal as PublishBlocked).message).not.toBe('')
  })

  it('refuses what the gate blocks, and never reaches the Host', async () => {
    const found = [blocker('Folder is required.'), blocker('To is required.')]
    const { host, store } = await opened({ gate: { blockers: async () => found } })

    const refusal = await store.publish().catch((error: unknown) => error)
    expect(refusal).toBeInstanceOf(PublishBlocked)
    // Every one of them, not the first: a user fixing one field at a time is a
    // user pressing Publish five times to find five mistakes.
    expect((refusal as PublishBlocked).diagnostics).toEqual(found)
    expect(host.published).toHaveLength(0)
  })

  it('keeps the session alive when it refuses, so the fix can be typed and saved', async () => {
    const { host, store } = await opened({
      gate: { blockers: async () => [blocker('Folder is required.')] },
    })
    await expect(store.publish()).rejects.toBeInstanceOf(PublishBlocked)

    expect(ready(store).claimed).toBe(true)
    store.apply(removeStep({ board: null, id: 's1' }))
    await vi.advanceTimersByTimeAsync(500)
    expect(host.writes).toHaveLength(1)
  })

  it('publishes when the gate finds nothing', async () => {
    const { host, store } = await opened({ gate: { blockers: async () => [] } })
    await store.publish()
    expect(host.published).toHaveLength(1)
  })

  it('publishes with no gate at all, on the floor alone', async () => {
    // A Host that serves no ManifestSource is correctly configured, not broken
    // — ADR-0022's argument at its limit, recorded in ADR-0023.
    const { host, store } = await opened()
    await store.publish()
    expect(host.published).toHaveLength(1)
  })

  it('waits for an answer rather than deciding without one', async () => {
    let answer: (found: Diagnostic[]) => void = () => {}
    const pending = new Promise<Diagnostic[]>((resolve) => {
      answer = resolve
    })
    const { host, store } = await opened({ gate: { blockers: () => pending } })

    const attempt = store.publish()
    await settle()
    expect(host.published).toHaveLength(0)

    answer([])
    await attempt
    expect(host.published).toHaveLength(1)
  })

  it('reads the text after the wait, so an edit made during it is not dropped', async () => {
    let answer: (found: Diagnostic[]) => void = () => {}
    const pending = new Promise<Diagnostic[]>((resolve) => {
      answer = resolve
    })
    const { host, store } = await opened({ gate: { blockers: () => pending } })

    const attempt = store.publish()
    await settle()
    store.apply(removeStep({ board: null, id: 's1' }))
    answer([])
    await attempt

    expect(host.published[0]).not.toContain('id: s1')
  })

  /*
   * "Refused unconditionally" has to mean at the moment of publishing rather
   * than at the moment of asking. Editing does not stop while the gate waits,
   * and a command that breaks the projection during it also empties the gate's
   * own answer — `createValidationStore` reports nothing about a document that
   * does not project — so nothing else would say no.
   */
  it('refuses a document that stopped projecting while the gate waited', async () => {
    let answer: (found: Diagnostic[]) => void = () => {}
    const pending = new Promise<Diagnostic[]>((resolve) => {
      answer = resolve
    })
    const { host, store } = await opened({ gate: { blockers: () => pending } })

    const attempt = store.publish()
    await settle()

    // Text Mode, or anything else that writes the document directly.
    const snapshot = ready(store)
    snapshot.document.ast.delete('steps')
    snapshot.document.ast.delete('version')

    answer([])
    await expect(attempt).rejects.toBeInstanceOf(PublishBlocked)
    expect(host.published).toHaveLength(0)
  })

  /*
   * `finish()` bumps the generation, drops the token and halts autosave. Run
   * late — the Host's publish is a network call and the session can end and
   * begin again underneath it — it does all of that to the session that
   * REPLACED this one, leaving a Draft the user visibly just reopened saved
   * nowhere and reporting that it has ended.
   */
  it('does not end the session that replaced it while the Host was publishing', async () => {
    let answer: (published: PublishedVersion) => void = () => {}
    const host = recorder()
    host.port.publish = () =>
      new Promise<PublishedVersion>((resolve) => {
        answer = resolve
      })

    const store = createEditingStore(host.port, 'wf_morning', { autosaveDelayMs: 100 })
    store.open()
    await settle()

    const attempt = store.publish()
    await settle()

    // A second session, opened while the first publish is still in the air.
    store.reopen()
    await settle()
    expect(ready(store).claimed).toBe(true)

    answer({ version: 9, publishedAt: '2026-01-01T00:00:00.000Z' })
    await attempt

    expect(ready(store).claimed).toBe(true)
    store.apply(removeStep({ board: null, id: 's1' }))
    await vi.advanceTimersByTimeAsync(200)
    expect(host.writes.length).toBeGreaterThan(0)
  })

  it('refuses to publish on a claim the session lost while it waited', async () => {
    let answer: (found: Diagnostic[]) => void = () => {}
    const pending = new Promise<Diagnostic[]>((resolve) => {
      answer = resolve
    })
    const { host, store } = await opened({ gate: { blockers: () => pending } })

    const attempt = store.publish()
    await settle()
    // Another tab took over, so this store reopened underneath the wait.
    store.reopen()
    await settle()
    answer([])

    await expect(attempt).rejects.toThrow(/session has ended/)
    expect(host.published).toHaveLength(0)
  })
})

describe('whether the session still holds the claim', () => {
  const opened = async () => {
    const host = recorder()
    const store = createEditingStore(host.port, 'wf_morning', { autosaveDelayMs: 500 })
    store.open()
    await settle()
    return { host, store }
  }

  it('is claimed while the Draft is open', async () => {
    const { store } = await opened()
    expect(ready(store).claimed).toBe(true)
  })

  /*
   * The state that was invisible. Publish, Release and Discard all drop the
   * token, and a session that ended with nothing queued leaves `save` reading
   * `saved` — so without this the snapshot after publishing is the snapshot of
   * a live session, and the user finds out by typing into a document that is
   * saved nowhere.
   */
  it('is not claimed after publish, release or discard — with nothing queued', async () => {
    for (const end of ['publish', 'release', 'discard'] as const) {
      const { store } = await opened()
      expect(ready(store).save).toEqual({ state: 'saved' })

      await store[end]()
      expect(ready(store).claimed, end).toBe(false)
      expect(ready(store).save, end).toEqual({ state: 'saved' })
    }
  })

  it('tells subscribers, rather than leaving them on the last snapshot', async () => {
    const { store } = await opened()
    let notifications = 0
    store.subscribe(() => {
      notifications++
    })

    await store.release()
    expect(notifications).toBeGreaterThan(0)
    expect(ready(store).claimed).toBe(false)
  })

  it('stays claimed when a publish is refused', async () => {
    const host = recorder()
    host.port.publish = async () => {
      throw new Error('Another session holds the edit on this workflow.')
    }
    const store = createEditingStore(host.port, 'wf_morning')
    store.open()
    await settle()

    await expect(store.publish()).rejects.toThrow(/Another session/)
    // ADR-0005 detects conflict here and nowhere else, so the session may only
    // end once the Host has said yes.
    expect(ready(store).claimed).toBe(true)
  })
})

describe('resuming a halted save', () => {
  const halted = async () => {
    let refuse = true
    const host = recorder()
    const writes: string[] = []
    host.port.saveDraft = async (_token, yaml) => {
      if (refuse) throw new Error('Lease expired.')
      writes.push(yaml)
    }
    const store = createEditingStore(host.port, 'wf_morning', { autosaveDelayMs: 500 })
    store.open()
    await settle()
    store.apply(removeStep({ board: null, id: 's1' }))
    await vi.advanceTimersByTimeAsync(500)

    return { store, writes, accept: () => (refuse = false) }
  }

  it('writes again on the claim it still holds, and the halt clears', async () => {
    const { store, writes, accept } = await halted()
    expect(ready(store).save).toMatchObject({ state: 'halted' })
    expect(ready(store).claimed).toBe(true)

    accept()
    store.resumeSaving()
    await vi.advanceTimersByTimeAsync(500)

    expect(writes).toHaveLength(1)
    expect(ready(store).save).toEqual({ state: 'saved' })
  })

  it('keeps the work, which is the whole reason it exists', async () => {
    // `reopen()` was the only exit, and it re-parses the Host's copy — throwing
    // away exactly what ADR-0005 halts in order to keep.
    const { store, accept } = await halted()
    accept()
    store.resumeSaving()
    await vi.advanceTimersByTimeAsync(500)

    expect(ready(store).definition?.steps.map((one) => one.id)).toEqual(['s2', 's4'])
  })

  /*
   * The halt this control answers is usually a refused RENEWAL, which fires on a
   * timer and therefore while nobody is typing. A resume that went straight to
   * the write queue would find the document already level with the Host, report
   * `saved`, and take the control off screen having verified nothing — and the
   * lease would lapse quietly a few seconds later.
   */
  it('re-checks the claim before clearing a halt on a document with nothing to write', async () => {
    let refuse = true
    let renewals = 0
    const host = recorder({ lease: leaseFor(0.05) })
    host.port.renewLease = async () => {
      renewals++
      if (refuse) throw new Error('Your lease on this workflow expired.')
      return leaseFor(30)
    }

    const store = createEditingStore(host.port, 'wf_morning', { autosaveDelayMs: 100 })
    store.open()
    await settle()
    // Nothing has been typed, so there is nothing for a write to verify with.
    await vi.advanceTimersByTimeAsync(2000)
    expect(ready(store).save).toMatchObject({ state: 'halted' })

    const before = renewals
    store.resumeSaving()
    await vi.advanceTimersByTimeAsync(0)

    // The Host was asked, and said no again — so the halt stands rather than the
    // bar going quiet on a claim nobody re-checked.
    expect(renewals).toBe(before + 1)
    expect(ready(store).save).toMatchObject({ state: 'halted' })

    refuse = false
    store.resumeSaving()
    await vi.advanceTimersByTimeAsync(0)
    expect(ready(store).save).toEqual({ state: 'saved' })
  })

  /*
   * A halt from a refused WRITE leaves the renewal timer armed — `halt()` only
   * cancels the save. Entering `renew()` out of band then dropped that handle
   * without clearing it and armed a second, so every resume doubled the renewal
   * rate for the life of the session.
   */
  it('does not leave a second renewal timer running behind it', async () => {
    let refuse = true
    let renewals = 0
    const host = recorder()
    host.port.saveDraft = async () => {
      if (refuse) throw new Error('Your lease on this workflow expired.')
    }
    host.port.renewLease = async () => {
      renewals++
      return leaseFor(30)
    }

    const store = createEditingStore(host.port, 'wf_morning', { autosaveDelayMs: 100 })
    store.open()
    await settle()

    store.apply(removeStep({ board: null, id: 's1' }))
    await vi.advanceTimersByTimeAsync(200)
    expect(ready(store).save).toMatchObject({ state: 'halted' })

    refuse = false
    store.resumeSaving()
    await vi.advanceTimersByTimeAsync(0)

    // One renewal per half-life from here, not two.
    const after = renewals
    await vi.advanceTimersByTimeAsync(16 * 60_000)
    expect(renewals).toBe(after + 1)
  })

  /*
   * A halt from a refused WRITE leaves the lease healthy and its renewal armed.
   * Cancelling that on the way to asking early takes a working renewal down with
   * a transient refusal: before the press the lease renews itself at the
   * half-way mark, and after it the claim simply lapses.
   */
  it('leaves the armed renewal alone when the early ask is refused', async () => {
    let refuseRenewal = false
    let renewals = 0
    const host = recorder()
    host.port.saveDraft = async () => {
      throw new Error('The workflow service is unreachable.')
    }
    host.port.renewLease = async () => {
      renewals++
      if (refuseRenewal) throw new Error('Not now.')
      return leaseFor(30)
    }

    const store = createEditingStore(host.port, 'wf_morning', { autosaveDelayMs: 100 })
    store.open()
    await settle()
    store.apply(removeStep({ board: null, id: 's1' }))
    await vi.advanceTimersByTimeAsync(200)
    expect(ready(store).save).toMatchObject({ state: 'halted' })

    // The early ask fails too — but the timer armed at open is still pending.
    refuseRenewal = true
    store.resumeSaving()
    await vi.advanceTimersByTimeAsync(0)
    const asked = renewals

    refuseRenewal = false
    await vi.advanceTimersByTimeAsync(16 * 60_000)
    expect(renewals).toBeGreaterThan(asked)
  })

  /*
   * A halt from a refused write leaves the lease timer armed, so a press and the
   * timer can both be in the air — and only the later answer is applied. Held on
   * the request that was asked for, the resume dies with the one that loses: a
   * healthy lease, a dirty document, and autosave refused for ever by a halt
   * nothing goes on to clear.
   */
  it('clears the halt on whichever renewal answers, not only the one it asked', async () => {
    const answers: ((lease: Lease) => void)[] = []
    let refuseWrite = true
    const host = recorder({ lease: leaseFor(30) })
    host.port.renewLease = () =>
      new Promise<Lease>((resolve) => {
        answers.push(resolve)
      })
    host.port.saveDraft = async () => {
      if (refuseWrite) throw new Error('The workflow service is unreachable.')
    }

    const store = createEditingStore(host.port, 'wf_morning', { autosaveDelayMs: 100 })
    store.open()
    await settle()
    store.apply(removeStep({ board: null, id: 's1' }))
    await vi.advanceTimersByTimeAsync(200)
    expect(ready(store).save).toMatchObject({ state: 'halted' })

    // The press asks first; the armed timer asks second and therefore wins.
    store.resumeSaving()
    await settle()
    await vi.advanceTimersByTimeAsync(16 * 60_000)
    expect(answers.length).toBeGreaterThan(1)

    refuseWrite = false
    answers[0]?.(leaseFor(30))
    await settle()
    answers[answers.length - 1]?.(leaseFor(30))
    await vi.advanceTimersByTimeAsync(200)

    expect(ready(store).save).not.toMatchObject({ state: 'halted' })
  })

  /*
   * The press belongs to the session that made it. Carried across an open, a
   * renewal in the NEXT session reads it, clears a halt nobody asked it to
   * clear, and reschedules the write — the automatic retry ADR-0005 refuses,
   * reached through a flag rather than a timer.
   */
  it('does not carry a resume into the session that replaces it', async () => {
    const answers: ((lease: Lease) => void)[] = []
    const host = recorder()
    host.port.renewLease = () =>
      new Promise<Lease>((resolve) => {
        answers.push(resolve)
      })
    host.port.saveDraft = async () => {
      throw new Error('The workflow service is unreachable.')
    }

    const store = createEditingStore(host.port, 'wf_morning', { autosaveDelayMs: 100 })
    store.open()
    await settle()
    store.apply(removeStep({ board: null, id: 's1' }))
    await vi.advanceTimersByTimeAsync(200)
    expect(ready(store).save).toMatchObject({ state: 'halted' })

    // Asked for, and then abandoned by a reopen before any renewal answered.
    store.resumeSaving()
    await settle()
    store.reopen()
    await settle()

    // A genuine halt in the new session, and a renewal that succeeds after it.
    store.apply(removeStep({ board: null, id: 's2' }))
    await vi.advanceTimersByTimeAsync(200)
    expect(ready(store).save).toMatchObject({ state: 'halted' })

    for (const answer of answers) answer(leaseFor(30))
    await vi.advanceTimersByTimeAsync(16 * 60_000)

    // Still halted: nobody asked this session to resume.
    expect(ready(store).save).toMatchObject({ state: 'halted' })
  })

  it('halts again, rather than spinning, when the Host says no twice', async () => {
    const { store } = await halted()
    store.resumeSaving()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(ready(store).save).toMatchObject({ state: 'halted' })
  })

  /*
   * A halt reached through a refused renewal takes the renewal timer with it:
   * `halt()` stops autosave and schedules nothing, and the only two callers of
   * `scheduleRenewal` are a successful renewal and a fresh open. Resuming writes
   * without re-arming it is the worst of both — the bar goes quiet, the token
   * still works, and the lease lapses a minute later carrying everything typed
   * since.
   */
  it('puts the lease back on a timer, not just the writes', async () => {
    let refuse = true
    let renewals = 0
    const host = recorder()
    host.port.renewLease = async () => {
      renewals++
      if (refuse) throw new Error('Your lease on this workflow expired.')
      return leaseFor(30)
    }

    const store = createEditingStore(host.port, 'wf_morning', { autosaveDelayMs: 500 })
    store.open()
    await settle()

    // A two-minute lease renews at the halfway mark, and the Host refuses.
    await vi.advanceTimersByTimeAsync(16 * 60_000)
    expect(ready(store).save).toMatchObject({ state: 'halted' })

    refuse = false
    const before = renewals
    store.resumeSaving()
    await vi.advanceTimersByTimeAsync(16 * 60_000)

    expect(renewals).toBeGreaterThan(before)
  })

  /*
   * The write succeeded, so the Host does hold the text — but the lease was
   * refused while it was in the air. Reporting `saved` would clear that halt:
   * the bar goes quiet with no renewal armed and no claim behind it, and
   * autosave goes on writing to a Host that has already said no.
   */
  it('does not let a successful write clear a halt that landed during it', async () => {
    let release: () => void = () => {}
    const host = recorder({ lease: leaseFor(0.05) })
    host.port.saveDraft = () =>
      new Promise<void>((resolve) => {
        release = resolve
      })
    host.port.renewLease = async () => {
      throw new Error('Your lease on this workflow expired.')
    }

    const store = createEditingStore(host.port, 'wf_morning', { autosaveDelayMs: 100 })
    store.open()
    await settle()

    store.apply(removeStep({ board: null, id: 's1' }))
    // The write goes out...
    await vi.advanceTimersByTimeAsync(150)
    expect(ready(store).save).toEqual({ state: 'saving' })

    // ...the renewal is refused while it is still in the air...
    await vi.advanceTimersByTimeAsync(2000)
    expect(ready(store).save).toMatchObject({ state: 'halted' })

    // ...and then the Host answers the write.
    release()
    await vi.advanceTimersByTimeAsync(50)

    expect(ready(store).save).toMatchObject({ state: 'halted' })
  })

  it('does nothing when the store is not halted', async () => {
    const host = recorder()
    const store = createEditingStore(host.port, 'wf_morning', { autosaveDelayMs: 500 })
    store.open()
    await settle()

    store.resumeSaving()
    await vi.advanceTimersByTimeAsync(500)
    expect(ready(store).save).toEqual({ state: 'saved' })
    expect(host.writes).toHaveLength(0)
  })

  /*
   * The halt after a session ends has no token behind it, so there is nothing
   * to write to. Putting the snapshot back to `pending` would promise a write
   * that can never run, with no timer behind it and no way out.
   */
  it('does nothing once the session has ended, because there is nothing to write to', async () => {
    const host = recorder()
    const store = createEditingStore(host.port, 'wf_morning', { autosaveDelayMs: 500 })
    store.open()
    await settle()
    store.apply(removeStep({ board: null, id: 's1' }))
    await store.release()

    expect(ready(store).claimed).toBe(false)
    store.apply(removeStep({ board: null, id: 's4' }))
    await vi.advanceTimersByTimeAsync(500)
    expect(ready(store).save).toMatchObject({ state: 'halted' })

    store.resumeSaving()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(ready(store).save).toMatchObject({ state: 'halted' })
  })
})

describe('a release the session outlived', () => {
  /*
   * `release()` awaits a last write, which is an unbounded wait on the Host, and
   * the session can begin again inside it. A late `finish()` bumps the
   * generation a second time — and an `openDraft` started in the meantime then
   * finds its own generation stale when its fetch lands and returns silently,
   * leaving the store at `opening` for good.
   */
  it('does not strand the session that replaced it', async () => {
    let release: () => void = () => {}
    const host = recorder()
    host.port.saveDraft = () =>
      new Promise<void>((resolve) => {
        release = resolve
      })

    const store = createEditingStore(host.port, 'wf_morning', { autosaveDelayMs: 100 })
    store.open()
    await settle()
    store.apply(removeStep({ board: null, id: 's1' }))

    const ending = store.release()
    await settle()

    store.reopen()
    await settle()

    release()
    await ending.catch(() => {})
    await settle()

    expect(store.getSnapshot().status).toBe('ready')
    expect(ready(store).claimed).toBe(true)
  })
})
