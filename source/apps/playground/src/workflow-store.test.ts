import type { EditToken, WorkflowStore } from '@hatua/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { createLocalWorkflowStore, createMemoryWorkflowStore, SEED } from './workflow-store'

/**
 * The Host's storage, tested as the Host's own code.
 *
 * `api-source.ts` had the same claim on a test file and for the same reason:
 * this is the side of the seam Hatua does not own, and everything Hatua relies
 * on — that a token is minted here, that a write is checked against the live
 * claim, that publishing archives the outgoing version — is a promise only
 * these tests hold anyone to. @hatua/services tests the editor against a fake
 * port; nothing there says a real implementation behaves like this one.
 *
 * The lease is what makes this worth testing rather than asserting. It is the
 * one piece of ADR-0005 that cannot live in Hatua at all: "exclusivity is only
 * enforceable by whoever issues the credential."
 */

/**
 * A Map behind the Web Storage API. The playground runs in a browser and this
 * suite runs in Node, and the store reaches for the global exactly the way a
 * page does — so the stub goes where the browser's would be rather than the
 * store growing a seam for the benefit of its test.
 */
const stubStorage = () => {
  const entries = new Map<string, string>()
  return {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => void entries.set(key, value),
    removeItem: (key: string) => void entries.delete(key),
    clear: () => entries.clear(),
    key: (index: number) => [...entries.keys()][index] ?? null,
    get length() {
      return entries.size
    },
  }
}

beforeEach(() => {
  globalThis.localStorage = stubStorage() as Storage
})

const WORKFLOW = 'wf_morning'

describe('opening a draft', () => {
  it('seeds a workflow the first time anyone asks for one', async () => {
    const store = createLocalWorkflowStore()
    const session = await store.openDraft(WORKFLOW)

    expect(session.yaml).toBe(SEED)
    expect(session.resumed).toBe(false)
  })

  it('mints the token itself, because only storage can enforce exclusivity', async () => {
    // ADR-0005. Hatua never picks a token — a Hatua-generated one would let two
    // clients choose different ones with this store unable to say which holds
    // the claim.
    const store = createLocalWorkflowStore()
    const first = await store.openDraft(WORKFLOW)
    const second = await store.openDraft(WORKFLOW)

    expect(first.token).toMatch(/^edit_/)
    expect(second.token).not.toBe(first.token)
  })

  it('resumes the existing Draft rather than making a second one', async () => {
    // At most one Draft exists per workflow: two would guarantee the second
    // Publish fails, forcing a merge or the loss of someone's work.
    const store = createLocalWorkflowStore()
    const first = await store.openDraft(WORKFLOW)
    await store.saveDraft(
      first.token,
      'id: w\nname: edited\nversion: 1\nstatus: draft\nsteps: []\n',
    )

    const second = await store.openDraft(WORKFLOW)
    expect(second.resumed).toBe(true)
    expect(second.yaml).toContain('name: edited')

    const { items } = await store.listVersions(WORKFLOW)
    expect(items.filter((entry) => entry.status === 'draft')).toHaveLength(1)
  })

  it('claims the edit in the same call that creates the Draft', async () => {
    // Atomic by construction: one read, one write. Splitting create from resume
    // would race — between checking whether a draft exists and claiming it,
    // another session can create one.
    const store = createLocalWorkflowStore()
    const session = await store.openDraft(WORKFLOW)
    await expect(store.saveDraft(session.token, SEED)).resolves.toBeUndefined()
  })

  it('hands back a lease that has not already lapsed', async () => {
    const store = createLocalWorkflowStore()
    const { lease } = await store.openDraft(WORKFLOW)
    expect(Date.parse(lease.expiresAt)).toBeGreaterThan(Date.now())
  })

  it('takes over a live claim, and the displaced session stops being able to write', async () => {
    // Takeover rather than refusal, deliberately: a page with no way to release
    // its claim on unload would lock itself out for a full lease on every
    // reload. What it buys is ADR-0005's rejected-write path, on screen, from
    // nothing more than opening a second tab.
    const store = createLocalWorkflowStore()
    const first = await store.openDraft(WORKFLOW)
    const second = await store.openDraft(WORKFLOW)

    await expect(store.saveDraft(first.token, SEED)).rejects.toThrow(/Another session holds/)
    await expect(store.saveDraft(second.token, SEED)).resolves.toBeUndefined()
  })

  it('reports being unreachable when told to', async () => {
    const store = createLocalWorkflowStore({ failToOpen: true })
    await expect(store.openDraft(WORKFLOW)).rejects.toThrow(/unreachable/)
  })

  it('starts over rather than refusing to open when the stored entry is corrupt', async () => {
    // A corrupt entry is the Host's problem, and an editor that will not open
    // is a worse answer than a fresh seed.
    localStorage.setItem('hatua.playground:wf_morning', '{not json')
    const store = createLocalWorkflowStore()
    await expect(store.openDraft(WORKFLOW)).resolves.toMatchObject({ yaml: SEED })
  })

  it('keeps two namespaces apart, so two pages do not fight over one workflow', async () => {
    const a = createLocalWorkflowStore({ namespace: 'a' })
    const b = createLocalWorkflowStore({ namespace: 'b' })

    const first = await a.openDraft(WORKFLOW)
    await b.openDraft(WORKFLOW)
    // b claimed its own copy; a's claim is untouched.
    await expect(a.saveDraft(first.token, SEED)).resolves.toBeUndefined()
  })

  it('serves a seed the caller chose', async () => {
    const yaml = 'id: w\nname: mine\nversion: 1\nstatus: draft\nsteps: []\n'
    const store = createLocalWorkflowStore({ seed: yaml })
    await expect(store.openDraft(WORKFLOW)).resolves.toMatchObject({ yaml })
  })

  it('waits when asked, so the opening state is visible', async () => {
    const store = createLocalWorkflowStore({ delayMs: 20 })
    const started = Date.now()
    await store.openDraft(WORKFLOW)
    expect(Date.now() - started).toBeGreaterThanOrEqual(15)
  })
})

describe('writing', () => {
  it('persists, so a reload resumes what was typed', async () => {
    const store = createLocalWorkflowStore()
    const { token } = await store.openDraft(WORKFLOW)
    await store.saveDraft(token, 'id: w\nname: typed\nversion: 1\nstatus: draft\nsteps: []\n')

    expect(await store.loadVersion(WORKFLOW, 1)).toContain('name: typed')
  })

  it('refuses a token that is not the live claim', async () => {
    const store = createLocalWorkflowStore()
    await store.openDraft(WORKFLOW)
    await expect(store.saveDraft('edit_made_up' as EditToken, SEED)).rejects.toThrow(
      /Another session holds/,
    )
  })

  it('refuses a claim that has lapsed', async () => {
    // The lease is the Host's, because a browser can vanish — closed laptop,
    // crashed tab — and exclusivity that depended solely on a client calling
    // home would eventually wedge a workflow nobody could edit.
    const store = createLocalWorkflowStore()
    const { token } = await store.openDraft(WORKFLOW)

    const key = 'hatua.playground:wf_morning'
    const stored = JSON.parse(localStorage.getItem(key) as string)
    stored.claim.expiresAt = new Date(Date.now() - 1000).toISOString()
    localStorage.setItem(key, JSON.stringify(stored))

    await expect(store.saveDraft(token, SEED)).rejects.toThrow(/lease .* expired/i)
  })

  it('refuses every write when configured to, whatever the token says', async () => {
    // The option the Host-authored page exists to switch on: without a store
    // that says no, "autosave halts rather than retrying" is untestable from a
    // browser.
    const store = createLocalWorkflowStore({ rejectWrites: true })
    const { token } = await store.openDraft(WORKFLOW)
    await expect(store.saveDraft(token, SEED)).rejects.toThrow(/refuses every write/)
  })

  it('renews a claim it still holds, and extends it', async () => {
    const store = createLocalWorkflowStore()
    const { token, lease } = await store.openDraft(WORKFLOW)
    await new Promise((resolve) => setTimeout(resolve, 5))

    const renewed = await store.renewLease(token)
    expect(Date.parse(renewed.expiresAt)).toBeGreaterThan(Date.parse(lease.expiresAt))
  })

  it('refuses to renew a claim that went to someone else', async () => {
    const store = createLocalWorkflowStore()
    const first = await store.openDraft(WORKFLOW)
    await store.openDraft(WORKFLOW)
    await expect(store.renewLease(first.token)).rejects.toThrow(/Another session holds/)
  })
})

describe('publish', () => {
  it('promotes the Draft and archives the version it replaced', async () => {
    const store = createLocalWorkflowStore()
    const first = await store.openDraft(WORKFLOW)
    const published = await store.publish(first.token, SEED)
    expect(published.version).toBe(1)

    // A second cycle: the new Draft is base + 1, and publishing it archives v1.
    const second = await store.openDraft(WORKFLOW)
    expect(second.resumed).toBe(false)
    await store.publish(second.token, SEED)

    const { items } = await store.listVersions(WORKFLOW)
    expect(items.map((entry) => [entry.version, entry.status])).toEqual([
      [2, 'published'],
      [1, 'archived'],
    ])
  })

  it('branches a new Draft from the live version rather than from the seed', async () => {
    const store = createLocalWorkflowStore()
    const first = await store.openDraft(WORKFLOW)
    const yaml = 'id: w\nname: published\nversion: 1\nstatus: draft\nsteps: []\n'
    await store.publish(first.token, yaml)

    const second = await store.openDraft(WORKFLOW)
    expect(second.yaml).toContain('name: published')
  })

  it('writes the text it was handed, not the last text it accepted', async () => {
    // Hatua publishes the CURRENT document because autosave may still be
    // pending, and a version that silently omits the user's last edit is the
    // one outcome worse than a rejected publish.
    const store = createLocalWorkflowStore()
    const { token } = await store.openDraft(WORKFLOW)
    const yaml = 'id: w\nname: unsaved\nversion: 1\nstatus: draft\nsteps: []\n'
    await store.publish(token, yaml)

    expect(await store.loadVersion(WORKFLOW, 1)).toContain('name: unsaved')
  })

  it('drops the claim, so a published version cannot be written to', async () => {
    const store = createLocalWorkflowStore()
    const { token } = await store.openDraft(WORKFLOW)
    await store.publish(token, SEED)
    await expect(store.saveDraft(token, SEED)).rejects.toThrow(/Another session holds/)
  })

  it('refuses a token that is not the live claim', async () => {
    const store = createLocalWorkflowStore()
    await store.openDraft(WORKFLOW)
    await expect(store.publish('edit_made_up' as EditToken, SEED)).rejects.toThrow(
      /Another session holds/,
    )
  })
})

describe('release and discard', () => {
  it('release keeps the Draft for whoever picks it up next', async () => {
    const store = createLocalWorkflowStore()
    const first = await store.openDraft(WORKFLOW)
    const yaml = 'id: w\nname: half done\nversion: 1\nstatus: draft\nsteps: []\n'
    await store.saveDraft(first.token, yaml)
    await store.releaseDraft(first.token)

    const second = await store.openDraft(WORKFLOW)
    expect(second.resumed).toBe(true)
    expect(second.yaml).toContain('name: half done')
  })

  it('release frees the claim without anyone taking it over', async () => {
    const store = createLocalWorkflowStore()
    const first = await store.openDraft(WORKFLOW)
    await store.releaseDraft(first.token)
    await expect(store.saveDraft(first.token, SEED)).rejects.toThrow(/Another session holds/)
  })

  it('discard throws the Draft away and frees its number', async () => {
    // A number only becomes permanent at Publish, so discarding one frees it.
    const store = createLocalWorkflowStore()
    const first = await store.openDraft(WORKFLOW)
    await store.publish(first.token, SEED)

    const second = await store.openDraft(WORKFLOW)
    await store.discardDraft(second.token)

    const { items } = await store.listVersions(WORKFLOW)
    expect(items.map((entry) => entry.version)).toEqual([1])

    const third = await store.openDraft(WORKFLOW)
    expect(third.resumed).toBe(false)
  })

  it('both refuse a token that is not the live claim', async () => {
    const store = createLocalWorkflowStore()
    await store.openDraft(WORKFLOW)
    const stale = 'edit_made_up' as EditToken
    await expect(store.releaseDraft(stale)).rejects.toThrow(/Another session holds/)
    await expect(store.discardDraft(stale)).rejects.toThrow(/Another session holds/)
  })
})

describe('versions', () => {
  it('lists newest first, with a total', async () => {
    const store = createLocalWorkflowStore()
    const first = await store.openDraft(WORKFLOW)
    await store.publish(first.token, SEED)
    await store.openDraft(WORKFLOW)

    const { items, total } = await store.listVersions(WORKFLOW)
    expect(items.map((entry) => entry.version)).toEqual([2, 1])
    expect(total).toBe(2)
  })

  it('says so when a version does not exist, rather than resolving nothing', async () => {
    const store = createLocalWorkflowStore()
    await store.openDraft(WORKFLOW)
    await expect(store.loadVersion(WORKFLOW, 99)).rejects.toThrow(/No version 99/)
  })

  /**
   * Publish enough times to need a second page.
   *
   * Each cycle publishes the draft and opens the next one, which is how a
   * version number becomes permanent (ADR-0005).
   */
  const publishTimes = async (store: WorkflowStore, times: number) => {
    for (let round = 0; round < times; round++) {
      const session = await store.openDraft(WORKFLOW)
      await store.publish(session.token, SEED)
    }
  }

  it('omits the cursor entirely for a workflow small enough not to need one', async () => {
    const store = createLocalWorkflowStore()
    await publishTimes(store, 2)

    const page = await store.listVersions(WORKFLOW)
    expect(page.next).toBeUndefined()
    expect(page.items).toHaveLength(2)
  })

  it('pages, and the pages join up into the whole history newest first', async () => {
    const store = createLocalWorkflowStore()
    await publishTimes(store, 7)

    const first = await store.listVersions(WORKFLOW)
    expect(first.items).toHaveLength(5)
    expect(first.next).toBeDefined()
    expect(first.total).toBe(7)

    const second = await store.listVersions(WORKFLOW, first.next)
    expect(second.next).toBeUndefined()

    const walked = [...first.items, ...second.items].map((entry) => entry.version)
    expect(walked).toEqual([7, 6, 5, 4, 3, 2, 1])
  })

  it('starts again rather than repeating itself when the cursor names a version that is gone', async () => {
    // A draft discarded between two pages frees its number, so a cursor naming
    // it resolves to nothing. Serving the whole list from index -1 would hand
    // back every version a second time and grow the caller's list for ever.
    const store = createLocalWorkflowStore()
    await publishTimes(store, 6)

    const page = await store.listVersions(WORKFLOW, '999')
    expect(page.items[0]?.version).toBe(6)
  })
})

describe('the in-memory store', () => {
  it('holds what it was given and keeps what is written to it', async () => {
    const store = createMemoryWorkflowStore()
    const { token, yaml, resumed } = await store.openDraft(WORKFLOW)
    expect(yaml).toBe(SEED)
    expect(resumed).toBe(false)

    await store.saveDraft(token, 'id: w\nname: kept\nversion: 1\nstatus: draft\nsteps: []\n')
    expect((await store.openDraft(WORKFLOW)).yaml).toContain('name: kept')
    expect(await store.loadVersion(WORKFLOW, 1)).toContain('name: kept')
  })

  it('holds its own copy, so three designers on one page do not share a document', async () => {
    // theme.html runs three at once. One store between them would be a page
    // about leases rather than about themes.
    const a = createMemoryWorkflowStore()
    const b = createMemoryWorkflowStore()

    const session = await a.openDraft(WORKFLOW)
    await a.saveDraft(session.token, 'id: w\nname: only a\nversion: 1\nstatus: draft\nsteps: []\n')

    expect((await b.openDraft(WORKFLOW)).yaml).toBe(SEED)
  })

  it('answers the rest of the port without persisting anything', async () => {
    const store = createMemoryWorkflowStore()
    const { token, lease } = await store.openDraft(WORKFLOW)

    expect(Date.parse(lease.expiresAt)).toBeGreaterThan(Date.now())
    expect(Date.parse((await store.renewLease(token)).expiresAt)).toBeGreaterThan(Date.now())
    expect((await store.publish(token, SEED)).version).toBe(1)
    expect((await store.listVersions(WORKFLOW)).items).toHaveLength(1)
    await expect(store.releaseDraft(token)).resolves.toBeUndefined()
    await expect(store.discardDraft(token)).resolves.toBeUndefined()
  })
})

/*
 * localStorage outlives the source tree. A history kept across a change to the
 * seed is a document written against a catalogue the page no longer serves —
 * every card reporting an unknown component with no fields to edit, which reads
 * as a broken build rather than as stale data.
 */
describe('a history from another seed', () => {
  it('is discarded, so the page opens the seed it ships with', async () => {
    const first = createLocalWorkflowStore({
      seed: 'id: wf\nname: old\nversion: 1\nstatus: draft\nsteps: []\n',
    })
    const held = await first.openDraft(WORKFLOW)
    expect(held.yaml).toContain('name: old')
    await first.saveDraft(held.token, `${held.yaml}# edited\n`)
    await first.releaseDraft(held.token)

    const second = createLocalWorkflowStore({
      seed: 'id: wf\nname: new\nversion: 1\nstatus: draft\nsteps: []\n',
    })
    const opened = await second.openDraft(WORKFLOW)
    expect(opened.yaml).toContain('name: new')
    expect(opened.resumed).toBe(false)
  })

  it('keeps a Draft across two stores built from the SAME seed', async () => {
    const seed = 'id: wf\nname: same\nversion: 1\nstatus: draft\nsteps: []\n'
    const first = createLocalWorkflowStore({ seed })
    const held = await first.openDraft(WORKFLOW)
    await first.saveDraft(held.token, `${held.yaml}# edited\n`)
    await first.releaseDraft(held.token)

    const opened = await createLocalWorkflowStore({ seed }).openDraft(WORKFLOW)
    expect(opened.yaml).toContain('# edited')
  })
})
