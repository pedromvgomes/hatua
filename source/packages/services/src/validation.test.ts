import type { Manifest } from '@hatua/schema'
import { describe, expect, it, vi } from 'vitest'
import { createEditingStore, type EditingStore } from './editing'
import { createManifestStore, type ManifestStore } from './manifests'
import type { DraftSession, EditToken, Lease, WorkflowStore } from './ports'
import { removeStep } from './steps'
import { createValidationStore } from './validation'

/**
 * The join between the document and the catalogue.
 *
 * The rules themselves are @hatua/model's and are tested there. What is tested
 * here is everything this store adds: that an answer is withheld until both
 * inputs mean something, that a snapshot stays referentially stable until one
 * of them moves, and that asking for the answer is what makes both arrive.
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

const wired = (yaml = MISSING, manifests: Manifest[] = CATALOGUE) => {
  const editing = createEditingStore(workflowPort(yaml), 'wf')
  const catalogue = createManifestStore({ loadManifests: async () => manifests })
  return { editing, catalogue, validation: createValidationStore(editing, catalogue) }
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
      all: [],
      ready: false,
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
