import type { Manifest } from '@hatua/schema'
import { describe, expect, it, vi } from 'vitest'
import { type ConnectionStore, createConnectionStore } from './connections'
import { createEditingStore, type EditingStore } from './editing'
import { createManifestStore, type ManifestStore } from './manifests'
import type { ConnectionSource, DraftSession, EditToken, Lease, WorkflowStore } from './ports'
import { removeStep } from './steps'
import { createValidationStore, publishBlockers } from './validation'

/**
 * The join between the document and the catalogue.
 *
 * The rules themselves are @hatua/model's and are tested there. What is tested
 * here is everything this store adds: that an answer is withheld until the
 * document and the catalogue mean something, that the Host's Connections narrow
 * the answer instead of withholding it, that a snapshot stays referentially
 * stable until one of its sources moves, and that asking for the answer is what
 * makes all of them arrive.
 */

const token = 'tok_v' as EditToken
const lease: Lease = { token, expiresAt: '2099-01-01T00:00:00.000Z' }

const VALID = `id: wf\nname: n\nversion: 1\nstatus: draft\nsteps:\n  - id: s1\n    use: component.email.send\n    with:\n      to: a@b.c\n`
const MISSING = `id: wf\nname: n\nversion: 1\nstatus: draft\nsteps:\n  - id: s1\n    use: component.email.send\n  - id: s2\n    use: component.email.send\n`

const CATALOGUE: Manifest[] = [
  {
    kind: 'component',
    use: 'component.email.send',
    name: 'Send email',
    fields: [{ k: 'to', label: 'To', kind: 'text', req: true }],
    outputs: [],
  },
]

const workflowPort = (yaml: string, overrides: Partial<WorkflowStore> = {}): WorkflowStore => ({
  async openDraft(): Promise<DraftSession> {
    return { token, lease, yaml, resumed: false }
  },
  async saveDraft() {},
  async renewLease() {
    return lease
  },
  async publish() {
    return { version: 2, publishedAt: '2026-01-01T00:00:00.000Z' }
  },
  async releaseDraft() {},
  async discardDraft() {},
  async listVersions() {
    return { items: [] }
  },
  async loadVersion() {
    return yaml
  },
  ...overrides,
})

const settle = async () => {
  for (let turn = 0; turn < 8; turn++) await Promise.resolve()
}

const wired = (
  yaml = MISSING,
  manifests: Manifest[] = CATALOGUE,
  connections?: ConnectionStore | null,
) => {
  const editing = createEditingStore(workflowPort(yaml), 'wf')
  const catalogue = createManifestStore({ loadManifests: async () => manifests })
  return {
    editing,
    catalogue,
    connections,
    validation: createValidationStore(editing, catalogue, connections),
  }
}

const opened = async (yaml?: string, manifests?: Manifest[]) => {
  const stores = wired(yaml, manifests)
  stores.validation.load()
  await settle()
  return stores
}

describe('withholding an answer', () => {
  /*
   * "Not checked yet" and "checked and nothing is wrong" are different facts.
   * Every Step is an unknown component until the manifests land, so a reader
   * that painted `byStep` without checking `ready` would mark every Step of a
   * perfectly good workflow on every load.
   */
  it('is not ready before anything has been asked for', () => {
    const { validation } = wired()
    expect(validation.getSnapshot()).toEqual({
      byStep: new Map(),
      byTrigger: new Map(),
      byBlock: new Map(),
      byConnection: new Map(),
      all: [],
      ready: false,
      connections: 'undescribed',
    })
  })

  it('is not ready while the Draft is still opening', async () => {
    const editing = createEditingStore(
      workflowPort(MISSING, { openDraft: () => new Promise<DraftSession>(() => {}) }),
      'wf',
    )
    const catalogue = createManifestStore({ loadManifests: async () => CATALOGUE })
    const validation = createValidationStore(editing, catalogue)

    validation.load()
    await settle()
    expect(validation.getSnapshot().ready).toBe(false)
  })

  it('is not ready while the catalogue is still loading', async () => {
    const editing = createEditingStore(workflowPort(MISSING), 'wf')
    const catalogue = createManifestStore({
      loadManifests: () => new Promise<Manifest[]>(() => {}),
    })
    const validation = createValidationStore(editing, catalogue)

    validation.load()
    await settle()
    expect(validation.getSnapshot().ready).toBe(false)
  })

  it('is not ready when the Draft failed to open', async () => {
    const editing = createEditingStore(
      workflowPort(MISSING, {
        openDraft: async () => {
          throw new Error('taken')
        },
      }),
      'wf',
    )
    const catalogue = createManifestStore({ loadManifests: async () => CATALOGUE })
    const validation = createValidationStore(editing, catalogue)

    validation.load()
    await settle()
    expect(validation.getSnapshot().ready).toBe(false)
  })

  it('is not ready when the catalogue failed', async () => {
    const failing = createEditingStore(workflowPort(MISSING), 'wf')
    const broken = createManifestStore({
      loadManifests: async () => {
        throw new Error('503')
      },
    })
    const store = createValidationStore(failing, broken)

    store.load()
    await settle()
    expect(store.getSnapshot().ready).toBe(false)
  })

  it('is not ready while the document does not project, because there are no Steps to mark', async () => {
    const { validation } = await opened('name: half written\n')
    expect(validation.getSnapshot().ready).toBe(false)
  })
})

describe('the answer', () => {
  it('indexes the diagnostics by Step, and flattens them for a count', async () => {
    const { validation } = await opened()
    const state = validation.getSnapshot()

    expect(state.ready).toBe(true)
    expect([...state.byStep.keys()].sort()).toEqual(['s1', 's2'])
    expect(state.all).toHaveLength(2)
    expect(state.all[0]?.message).toBe('To is required.')
  })

  it('is ready and empty for a workflow with nothing wrong', async () => {
    // Empty is not the same as unready, and this is the pair that proves a
    // reader can tell them apart.
    const { validation } = await opened(VALID)
    const state = validation.getSnapshot()

    expect(state.ready).toBe(true)
    expect(state.byStep.size).toBe(0)
    expect(state.all).toHaveLength(0)
  })

  it('indexes what belongs to a Block rather than to any Step on it', async () => {
    // A third map for the reason the second exists: the surface listing the
    // Blocks a document declares is not the one drawing its Steps, and a Block
    // id filed under a Step's key would be painted on whichever row matched.
    const recursive = `id: wf\nname: n\nversion: 1\nstatus: draft\nsteps: []\nblocks:\n  - id: loop\n    steps:\n      - id: again\n        use: block.loop\n`
    const { validation } = await opened(recursive)
    const state = validation.getSnapshot()

    expect([...state.byBlock.keys()]).toEqual(['loop'])
    expect(state.byBlock.get('loop')?.map((one) => one.code)).toEqual(['BLOCK_RECURSION'])
    expect(state.byStep.size).toBe(0)
  })

  it('marks every Step when the catalogue declares none of them', async () => {
    const { validation } = await opened(MISSING, [])
    const state = validation.getSnapshot()

    expect(state.ready).toBe(true)
    expect(state.all.map((d) => d.code)).toEqual(['COMPONENT_UNKNOWN', 'COMPONENT_UNKNOWN'])
  })
})

describe('referential stability', () => {
  /*
   * `useSyncExternalStore` re-renders forever if getSnapshot builds a fresh
   * object each call. This store holds no state of its own, so the guarantee
   * has to come from memoising on the identity of the two source snapshots —
   * both of which are stable until something changes.
   */
  it('returns the same object while neither input has moved', async () => {
    const { validation } = await opened()
    const first = validation.getSnapshot()

    expect(validation.getSnapshot()).toBe(first)
    expect(validation.getSnapshot()).toBe(first)
  })

  it('returns the same object before either input is ready, too', () => {
    const { validation } = wired()
    expect(validation.getSnapshot()).toBe(validation.getSnapshot())
  })

  it('recomputes when the document changes', async () => {
    const { editing, validation } = await opened()
    const before = validation.getSnapshot()
    expect(before.all).toHaveLength(2)

    editing.apply(removeStep({ board: null, id: 's2' }))

    const after = validation.getSnapshot()
    expect(after).not.toBe(before)
    expect(after.all).toHaveLength(1)
  })

  it('recomputes when the catalogue changes', async () => {
    const editing = createEditingStore(workflowPort(MISSING), 'wf')
    let served: Manifest[] = []
    const catalogue = createManifestStore({ loadManifests: async () => served })
    const validation = createValidationStore(editing, catalogue)

    validation.load()
    await settle()
    expect(validation.getSnapshot().all.map((d) => d.code)).toEqual([
      'COMPONENT_UNKNOWN',
      'COMPONENT_UNKNOWN',
    ])

    served = CATALOGUE
    catalogue.reload()
    await settle()

    expect(validation.getSnapshot().all.map((d) => d.code)).toEqual([
      'FIELD_REQUIRED',
      'FIELD_REQUIRED',
    ])
  })

  it('keeps the unready snapshot stable across a change that leaves it unready', async () => {
    const { editing, validation } = await opened('name: half written\n')
    const before = validation.getSnapshot()

    editing.apply(removeStep({ board: null, id: 'nope' }))
    expect(validation.getSnapshot()).toBe(before)
  })
})

describe('subscribing', () => {
  it('notifies when either input moves', async () => {
    const { editing, catalogue, validation } = wired()
    const seen = vi.fn()
    validation.subscribe(seen)

    editing.open()
    await settle()
    const afterDocument = seen.mock.calls.length
    expect(afterDocument).toBeGreaterThan(0)

    catalogue.load()
    await settle()
    expect(seen.mock.calls.length).toBeGreaterThan(afterDocument)
  })

  it('unsubscribes from both, so neither keeps calling a dead listener', async () => {
    const { editing, catalogue, validation } = wired()
    const seen = vi.fn()
    const stop = validation.subscribe(seen)

    validation.load()
    await settle()
    stop()

    const before = seen.mock.calls.length
    editing.apply(removeStep({ board: null, id: 's1' }))
    catalogue.reload()
    await settle()

    expect(seen.mock.calls.length).toBe(before)
  })
})

describe('load()', () => {
  it('asks for both inputs, because validation is a question about one against the other', async () => {
    // A Host mounting the Flow tab and no Library would otherwise never fetch a
    // manifest, and every Step would sit unvalidated with nothing saying why.
    const opens = vi.fn(
      async (): Promise<DraftSession> => ({
        token,
        lease,
        yaml: MISSING,
        resumed: false,
      }),
    )
    const loads = vi.fn(async () => CATALOGUE)

    const editing = createEditingStore(workflowPort(MISSING, { openDraft: opens }), 'wf')
    const catalogue = createManifestStore({ loadManifests: loads })
    createValidationStore(editing, catalogue).load()
    await settle()

    expect(opens).toHaveBeenCalledTimes(1)
    expect(loads).toHaveBeenCalledTimes(1)
  })

  it('is idempotent, so every reader may call it and only the first fetches', async () => {
    const opens = vi.fn(
      async (): Promise<DraftSession> => ({
        token,
        lease,
        yaml: MISSING,
        resumed: false,
      }),
    )
    const loads = vi.fn(async () => CATALOGUE)

    const editing: EditingStore = createEditingStore(
      workflowPort(MISSING, { openDraft: opens }),
      'wf',
    )
    const catalogue: ManifestStore = createManifestStore({ loadManifests: loads })
    const validation = createValidationStore(editing, catalogue)

    validation.load()
    validation.load()
    validation.load()
    await settle()

    expect(opens).toHaveBeenCalledTimes(1)
    expect(loads).toHaveBeenCalledTimes(1)
  })
})

/*
 * A Connection's type is the one input that is not in the document, so absence
 * is a state these rules have to hold, and both ways of getting it wrong are
 * worse than the bug being fixed. A store that reported CONNECTION_UNRESOLVABLE
 * before the Host had answered would refuse Publish to a workflow with nothing
 * wrong with it, forever for a Host wiring no ConnectionSource; one that
 * withheld the whole answer instead would leave that same Host with no
 * validation at all.
 */

const CONNECTED = `id: wf
name: n
version: 1
status: draft
connections:
  - id: mailbox
    ref: cx_ok
  - id: unwired
    ref: null
steps:
  - id: s1
    use: component.email.send
    with:
      to: a@b.c
      connection: mailbox
`

const CONN_CATALOGUE: Manifest[] = [
  {
    kind: 'component',
    use: 'component.email.send',
    name: 'Send email',
    fields: [
      { k: 'to', label: 'To', kind: 'text', req: true },
      { k: 'connection', label: 'Mailbox', kind: 'conn', conn_type: 'email' },
    ],
    outputs: [],
  },
]

const listing = (items: { ref: string; type: string }[]): ConnectionSource => ({
  async listConnections() {
    return { items }
  },
})

const never: ConnectionSource = { listConnections: () => new Promise(() => {}) }
const refuses: ConnectionSource = {
  async listConnections() {
    throw new Error('nope')
  },
}

const withConnections = async (source?: ConnectionSource) => {
  const store = source ? createConnectionStore(source) : null
  const stores = wired(CONNECTED, CONN_CATALOGUE, store)
  stores.validation.load()
  await settle()
  return stores.validation.getSnapshot()
}

describe('what the connection rules are worth saying', () => {
  it('checks every code once the Host has listed its Connections', async () => {
    const found = await withConnections(listing([{ ref: 'cx_ok', type: 'email' }]))
    expect(found.connections).toBe('checked')
    expect(found.all.map((d) => d.code)).toEqual(['CONNECTION_NOT_ESTABLISHED'])
  })

  it('calls an empty list an answer, so a ref it does not hold no longer resolves', async () => {
    // A Host with nothing established is answering, not silent — which is the
    // one case where CONNECTION_UNRESOLVABLE is the honest report.
    const found = await withConnections(listing([]))
    expect(found.connections).toBe('checked')
    expect(found.all.map((d) => d.code).sort()).toEqual([
      'CONNECTION_NOT_ESTABLISHED',
      'CONNECTION_UNRESOLVABLE',
    ])
  })

  it('says nothing about a type while the port has not answered', async () => {
    const found = await withConnections(never)
    expect(found.connections).toBe('pending')
    expect(found.all.map((d) => d.code)).not.toContain('CONNECTION_UNRESOLVABLE')
  })

  it('says nothing about a type when the port failed, and does not wait on it', async () => {
    const found = await withConnections(refuses)
    expect(found.connections).toBe('undescribed')
    expect(found.all.map((d) => d.code)).not.toContain('CONNECTION_UNRESOLVABLE')
  })

  it('says nothing about a type when no ConnectionSource is wired', async () => {
    const found = await withConnections()
    expect(found.connections).toBe('undescribed')
    expect(found.all.map((d) => d.code)).not.toContain('CONNECTION_UNRESOLVABLE')
  })

  /*
   * The regression that would pass every test not written for it. A Host that
   * wires no ConnectionSource is correctly configured, and must still be told
   * about a required field it left empty.
   */
  it('validates everything else whether or not anything can describe a Connection', async () => {
    for (const source of [undefined, never, refuses]) {
      const found = await withConnections(source)
      expect(found.ready).toBe(true)
      expect(found.all.map((d) => d.code)).toContain('CONNECTION_NOT_ESTABLISHED')
    }

    const unfilled = await (async () => {
      const stores = wired(MISSING, CATALOGUE, null)
      stores.validation.load()
      await settle()
      return stores.validation.getSnapshot()
    })()
    expect(unfilled.ready).toBe(true)
    expect(unfilled.all.map((d) => d.code)).toContain('FIELD_REQUIRED')
  })

  it('files a Connection nothing wired under its own id, where no Step could hold it', async () => {
    const found = await withConnections(listing([{ ref: 'cx_ok', type: 'email' }]))
    expect([...found.byConnection.keys()]).toEqual(['unwired'])
  })

  it('recomputes when the Host answers, and holds the snapshot still until it does', async () => {
    let answer: (items: { ref: string; type: string }[]) => void = () => {}
    const store = createConnectionStore({
      listConnections: () =>
        new Promise((resolve) => {
          answer = (items) => resolve({ items })
        }),
    })
    const stores = wired(CONNECTED, CONN_CATALOGUE, store)
    stores.validation.load()
    await settle()

    // The document and the catalogue have landed, so the answer means
    // something; the Host has not spoken, so two of the codes are not in it.
    const before = stores.validation.getSnapshot()
    expect(before.ready).toBe(true)
    expect(before.connections).toBe('pending')
    expect(stores.validation.getSnapshot()).toBe(before)

    answer([{ ref: 'cx_ok', type: 'llm' }])
    await settle()

    const after = stores.validation.getSnapshot()
    expect(after).not.toBe(before)
    expect(after.connections).toBe('checked')
    expect(after.all.map((d) => d.code)).toContain('CONNECTION_TYPE_MISMATCH')
  })

  it('asks the Host for its Connections itself, so a Host that opens no form is still checked', async () => {
    const listConnections = vi.fn(async () => ({ items: [] }))
    const store = createConnectionStore({ listConnections })
    const stores = wired(CONNECTED, CONN_CATALOGUE, store)

    expect(listConnections).not.toHaveBeenCalled()
    stores.validation.load()
    await settle()
    expect(listConnections).toHaveBeenCalledTimes(1)
  })
})

describe('what blocks a publish', () => {
  it('answers with nothing when there is no validation store to ask', async () => {
    const { catalogue } = await opened()
    await expect(publishBlockers(null, catalogue)).resolves.toEqual([])
  })

  it('reports what the checker found, once it has found it', async () => {
    const { validation, catalogue } = await opened(MISSING)
    const found = await publishBlockers(validation, catalogue)

    expect(found).toHaveLength(2)
    expect(found.map((one) => one.code)).toEqual(['FIELD_REQUIRED', 'FIELD_REQUIRED'])
  })

  it('reports nothing for a workflow with nothing wrong with it', async () => {
    const { validation, catalogue } = await opened(VALID)
    await expect(publishBlockers(validation, catalogue)).resolves.toEqual([])
  })

  /*
   * `validation.ts` says of `pending` that "the port has not replied yet. It
   * will, so a Publish gate may wait." This is that sentence, kept.
   */
  it('waits for the catalogue rather than answering without it', async () => {
    let arrive: (manifests: Manifest[]) => void = () => {}
    const pending = new Promise<Manifest[]>((resolve) => {
      arrive = resolve
    })
    const editing = createEditingStore(workflowPort(MISSING), 'wf')
    const catalogue = createManifestStore({ loadManifests: () => pending })
    const validation = createValidationStore(editing, catalogue, null)
    validation.load()
    await settle()

    let answered: readonly unknown[] | null = null
    void publishBlockers(validation, catalogue).then((found) => {
      answered = found
    })
    await settle()
    expect(answered).toBeNull()

    arrive(CATALOGUE)
    await settle()
    expect(answered).toHaveLength(2)
  })

  it('waits while the Host has not said what its Connections are', async () => {
    let arrive: (found: never[]) => void = () => {}
    const pending = new Promise<never[]>((resolve) => {
      arrive = resolve
    })
    const source: ConnectionSource = { listConnections: () => pending as never }
    const { validation, catalogue } = (() => {
      const stores = wired(MISSING, CATALOGUE, createConnectionStore(source))
      stores.validation.load()
      return stores
    })()
    await settle()

    let answered: readonly unknown[] | null = null
    void publishBlockers(validation, catalogue).then((found) => {
      answered = found
    })
    await settle()
    expect(answered).toBeNull()

    arrive([])
    await settle()
    expect(answered).toHaveLength(2)
  })

  /*
   * The case that would otherwise hang Publish for ever. `ready` is false both
   * while the manifests are arriving and permanently after they fail to, so a
   * gate waiting on `ready` alone never answers for a Host whose manifest
   * endpoint is down — and a Publish that never answers is worse than one that
   * publishes unchecked.
   */
  it('answers rather than waiting when the catalogue failed', async () => {
    const editing = createEditingStore(workflowPort(MISSING), 'wf')
    const catalogue = createManifestStore({
      loadManifests: async () => {
        throw new Error('unreachable')
      },
    })
    const validation = createValidationStore(editing, catalogue, null)
    validation.load()
    await settle()

    await expect(publishBlockers(validation, catalogue)).resolves.toEqual([])
  })

  it('answers rather than waiting when nobody can describe the Connections', async () => {
    // `undescribed` never resolves, so waiting on it never ends. ADR-0022:
    // narrow the check, never withhold it.
    const stores = wired(MISSING, CATALOGUE, null)
    stores.validation.load()
    await settle()

    await expect(publishBlockers(stores.validation, stores.catalogue)).resolves.toHaveLength(2)
  })
})

describe('a gate nobody has loaded the catalogue for', () => {
  /*
   * A manifest store nobody has called `load()` on sits at `loading` for ever:
   * that is a fetch not started rather than one in flight. A gate that only
   * waited would never answer, and the Publish behind it would hang — which is
   * the failure `publishBlockers` exists to avoid, arrived at from the other
   * side.
   */
  it('asks for the catalogue rather than waiting to be handed one', async () => {
    const editing = createEditingStore(workflowPort(MISSING), 'wf')
    const catalogue = createManifestStore({ loadManifests: async () => CATALOGUE })
    const validation = createValidationStore(editing, catalogue, null)
    // Deliberately no `validation.load()`: nothing has mounted.
    expect(catalogue.getSnapshot().status).toBe('loading')

    await expect(publishBlockers(validation, catalogue)).resolves.toHaveLength(2)
  })
})

describe('a gate waiting on a Host that never answers', () => {
  /*
   * "It will reply" is true of a Host that replies. One whose manifest fetch
   * hangs leaves the catalogue loading for the life of the page, and a gate
   * waiting on that never answers — so the press is never heard back from and
   * every control it disabled stays disabled.
   *
   * Nothing is spent while it waits: no claim, no version, no call to the port.
   * So giving up and reporting what IS known is ADR-0022's narrowing, reached by
   * clock instead of by a port's answer.
   */
  it('gives up after its deadline and answers with what is known', async () => {
    vi.useFakeTimers()
    try {
      const editing = createEditingStore(workflowPort(MISSING), 'wf')
      // Never settles, which is what a fetch with no timeout does.
      const catalogue = createManifestStore({ loadManifests: () => new Promise(() => {}) })
      const validation = createValidationStore(editing, catalogue, null)
      validation.load()
      await vi.advanceTimersByTimeAsync(0)

      let answered: readonly unknown[] | null = null
      void publishBlockers(validation, catalogue, { deadlineMs: 50 }).then((found) => {
        answered = found
      })

      await vi.advanceTimersByTimeAsync(10)
      expect(answered).toBeNull()

      await vi.advanceTimersByTimeAsync(100)
      // Nothing could be checked, so nothing is reported — and the press is
      // answered rather than left hanging.
      expect(answered).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })

  it('answers before the deadline when the catalogue lands', async () => {
    vi.useFakeTimers()
    try {
      let arrive: (manifests: Manifest[]) => void = () => {}
      const pending = new Promise<Manifest[]>((resolve) => {
        arrive = resolve
      })
      const editing = createEditingStore(workflowPort(MISSING), 'wf')
      const catalogue = createManifestStore({ loadManifests: () => pending })
      const validation = createValidationStore(editing, catalogue, null)
      validation.load()
      await vi.advanceTimersByTimeAsync(0)

      let answered: readonly unknown[] | null = null
      void publishBlockers(validation, catalogue, { deadlineMs: 10_000 }).then((found) => {
        answered = found
      })

      arrive(CATALOGUE)
      await vi.advanceTimersByTimeAsync(0)
      expect(answered).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })
})
