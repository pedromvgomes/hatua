import type {
  Cursor,
  DraftSession,
  EditToken,
  Lease,
  PublishedVersion,
  VersionSummary,
  WorkflowStore,
} from '@hatua/react'

/**
 * The Host's storage, in localStorage.
 *
 * Hatua has no server, no database and no idea where a Workflow Definition
 * lives — `WorkflowStore` is the whole of that seam, and this file is what a
 * Host writes on the other side of it. localStorage is an honest choice here
 * for the same reason `api-source.ts`'s endpoint is a dev-server middleware: it
 * is a real store with real persistence, and everything Hatua can see about it
 * is identical to what it would see from a database.
 *
 * What is NOT faked, because it is the part worth having a Host for:
 *
 *  - **The token is minted here.** ADR-0005: exclusivity is only enforceable by
 *    whoever issues the credential. Hatua never picks one; it carries the one
 *    it was handed and presents it on every write.
 *  - **`openDraft` is atomic.** Create-or-resume-and-claim happens in one call.
 *    Splitting it would race, and this implementation is small enough to see
 *    that it does not.
 *  - **A write is checked.** `saveDraft` refuses a token that is not the live
 *    claim, or a lease that has lapsed. That refusal is what makes the store's
 *    "a rejected write halts autosave" behaviour reachable from the browser
 *    rather than only from a unit test.
 *  - **The lease is the Host's.** A browser can vanish — closed laptop, crashed
 *    tab — so exclusivity that depended solely on a client calling home would
 *    eventually wedge a workflow nobody could edit. It expires here.
 *
 * Two tabs on the same machine are enough to watch it work, and what you see is
 * a **takeover**, not a refusal: the second tab claims the workflow and the
 * first one halts on its next autosave with "another session holds the edit".
 * That is deliberate, and it is the more useful half of ADR-0005 to be able to
 * look at — the rejected-write path, on screen, without anyone having to break
 * anything. Refusing the second tab instead would be defensible in a real Host,
 * but a page with no way to release its claim on unload would then lock itself
 * out for the length of a lease every time you reloaded it.
 *
 * A real Host picks between those two on its own terms; the shape of the port
 * is the same either way, which is the only thing Hatua can see.
 *
 * What is faked: nothing about the contract, only its scale. One browser, one
 * origin, no server.
 */

/** The workflow every page starts from, written the way a person writes one. */
export const SEED = `# The overnight triage. Edit it and watch it autosave —
# there is no Save button anywhere, by design (ADR-0005).
id: wf_morning
name: "Morning inbox triage"
version: 1
status: draft

steps:
  - id: s1
    use: email.fetch
    name: "Fetch overnight mail"
    with:
      folder: INBOX      # not Archive
  - id: s2
    use: core.fork
    name: "How much came in?"
    branches:
      - label: A lot
        when: "{{ s1.count > 10 }}"
        steps:
          - id: s3
            use: agent.classify
            name: "Sort by urgency"
      - label: Otherwise
        steps: []
  - id: s4
    use: core.for_each
    name: "Each message"
    steps:
      - id: s5
        use: email.send
        name: "Send the digest"
`

interface Stored {
  versions: { version: number; status: VersionSummary['status']; updatedAt: string; yaml: string }[]
  claim?: { token: string; expiresAt: string }
}

/** How long a claim survives without renewal. Short, so the expiry is watchable. */
const LEASE_MS = 60_000

const now = () => new Date().toISOString()

export interface LocalWorkflowStoreOptions {
  /** Namespaced so two pages of the playground do not fight over one workflow. */
  namespace?: string
  /** Seed written on first use. */
  seed?: string
  /** Refuse every write, whatever the token says. */
  rejectWrites?: boolean
  /** Milliseconds to wait before answering, so the opening state is visible. */
  delayMs?: number
  /** Fail `openDraft` outright. */
  failToOpen?: boolean
}

export function createLocalWorkflowStore(options: LocalWorkflowStoreOptions = {}): WorkflowStore {
  const {
    namespace = 'hatua.playground',
    seed = SEED,
    rejectWrites = false,
    delayMs = 0,
    failToOpen = false,
  } = options

  const keyFor = (workflowId: string) => `${namespace}:${workflowId}`

  /**
   * What is stored, or an empty history when nothing is.
   *
   * It used to return a seeded Draft here, which made every read look like a
   * workflow that already had one — so the very first `openDraft` reported
   * `resumed: true` and told the user it had picked up somebody else's work.
   * "Nothing is stored" and "a Draft exists" are different facts and only
   * `openDraft` gets to turn the first into the second.
   */
  const read = (workflowId: string): Stored => {
    const raw = localStorage.getItem(keyFor(workflowId))
    if (raw) {
      try {
        return JSON.parse(raw) as Stored
      } catch {
        // A corrupt entry is the Host's problem, and starting over is a better
        // answer than an editor that will not open.
      }
    }
    return { versions: [] }
  }

  const write = (workflowId: string, stored: Stored) =>
    localStorage.setItem(keyFor(workflowId), JSON.stringify(stored))

  const wait = () => (delayMs ? new Promise((resolve) => setTimeout(resolve, delayMs)) : null)

  /**
   * The one check the whole design rests on. A token that is not the live claim
   * — or one whose lease has lapsed — is not the holder of the edit, and every
   * mutation goes through here.
   */
  const claimed = (workflowId: string, token: EditToken): Stored => {
    const stored = read(workflowId)
    if (!stored.claim || stored.claim.token !== token) {
      throw new Error('Another session holds the edit on this workflow.')
    }
    if (Date.parse(stored.claim.expiresAt) < Date.now()) {
      throw new Error('Your lease on this workflow expired.')
    }
    return stored
  }

  const leaseFor = (token: string): Lease => ({
    token: token as EditToken,
    expiresAt: new Date(Date.now() + LEASE_MS).toISOString(),
  })

  return {
    async openDraft(workflowId): Promise<DraftSession> {
      await wait()
      if (failToOpen) throw new Error('The workflow service is unreachable.')

      const stored = read(workflowId)
      const live = stored.versions.find((entry) => entry.status === 'published')
      let draft = stored.versions.find((entry) => entry.status === 'draft')
      const resumed = draft !== undefined

      // Create-or-resume AND claim, in one pass over the stored value. Two
      // calls would race: between checking whether a draft exists and claiming
      // it, another session can create one.
      if (!draft) {
        draft = {
          version: (live?.version ?? 0) + 1,
          status: 'draft',
          updatedAt: now(),
          yaml: live?.yaml ?? seed,
        }
        stored.versions.push(draft)
      }

      // Minted by storage, which is the only place it can be minted from — a
      // Hatua-generated token would let two clients pick different ones with
      // this store unable to say which holds the claim.
      //
      // Claiming here also REVOKES whatever claim was live: the previous
      // holder's token stops matching, so its next write is refused and its
      // editor halts. See the takeover note at the top of this file.
      //
      // Random, not a timestamp. `Date.now()` gave two tabs opened in the same
      // millisecond the SAME token — and a token that collides is not a claim
      // at all: the displaced session goes on writing because its token still
      // matches, which is the one thing this whole mechanism exists to stop.
      const displaced = stored.claim
      const token = `edit_${draft.version}_${crypto.randomUUID()}`
      const lease = leaseFor(token)
      stored.claim = { token, expiresAt: lease.expiresAt }
      write(workflowId, stored)

      if (displaced && Date.parse(displaced.expiresAt) > Date.now()) {
        console.info(
          '[playground] took over a live claim; the other session will halt on its next save',
        )
      }

      return { token: token as EditToken, lease, yaml: draft.yaml, resumed }
    },

    async saveDraft(token, yaml) {
      await wait()
      // Deliberately awkward, and the reason this page exists: a store that
      // says no is what proves the editor halts autosave rather than spinning
      // on it, and keeps the user's document rather than discarding it.
      if (rejectWrites) throw new Error('This store refuses every write.')

      const workflowId = workflowOf(token)
      const stored = claimed(workflowId, token)
      const draft = stored.versions.find((entry) => entry.status === 'draft')
      if (!draft) throw new Error('There is no draft to save.')

      draft.yaml = yaml
      draft.updatedAt = now()
      write(workflowId, stored)
    },

    async renewLease(token): Promise<Lease> {
      const workflowId = workflowOf(token)
      const stored = claimed(workflowId, token)
      const lease = leaseFor(token)
      stored.claim = { token, expiresAt: lease.expiresAt }
      write(workflowId, stored)
      return lease
    },

    async publish(token, yaml): Promise<PublishedVersion> {
      const workflowId = workflowOf(token)
      const stored = claimed(workflowId, token)
      const draft = stored.versions.find((entry) => entry.status === 'draft')
      if (!draft) throw new Error('There is no draft to publish.')

      // Publishing archives the outgoing live version and makes the draft's
      // number permanent. Only this can collide, which is why it is the only
      // place a conflict is detected (ADR-0005).
      for (const entry of stored.versions) {
        if (entry.status === 'published') entry.status = 'archived'
      }
      draft.yaml = yaml
      draft.status = 'published'
      draft.updatedAt = now()
      stored.claim = undefined
      write(workflowId, stored)

      return { version: draft.version, publishedAt: draft.updatedAt }
    },

    async releaseDraft(token) {
      const workflowId = workflowOf(token)
      const stored = claimed(workflowId, token)
      // The draft stays for whoever picks it up next; only the claim goes.
      stored.claim = undefined
      write(workflowId, stored)
    },

    async discardDraft(token) {
      const workflowId = workflowOf(token)
      const stored = claimed(workflowId, token)
      stored.versions = stored.versions.filter((entry) => entry.status !== 'draft')
      stored.claim = undefined
      write(workflowId, stored)
    },

    async listVersions(workflowId): Promise<Cursor<VersionSummary>> {
      await wait()
      const stored = read(workflowId)
      return {
        items: [...stored.versions]
          .sort((a, b) => b.version - a.version)
          .map(({ version, status, updatedAt }) => ({ version, status, updatedAt })),
        total: stored.versions.length,
      }
    },

    async loadVersion(workflowId, version) {
      await wait()
      const found = read(workflowId).versions.find((entry) => entry.version === version)
      if (!found) throw new Error(`No version ${version} of ${workflowId}.`)
      return found.yaml
    },
  }
}

/**
 * Which workflow a token belongs to.
 *
 * The playground serves one workflow, so this answers with its id. A real Host
 * decodes the token or looks it up — the point of the indirection is that the
 * token is opaque to Hatua and meaningful only to whoever minted it, which is
 * exactly why the port passes a token and not a workflow id to `saveDraft`.
 */
const workflowOf = (_token: EditToken) => 'wf_morning'

/**
 * A store with no persistence at all, for the pages that are about something
 * else. Each instance holds its own copy, so three designers on one page do not
 * fight over one claim.
 */
export function createMemoryWorkflowStore(yaml = SEED): WorkflowStore {
  let held = yaml
  const token = 'edit_memory' as EditToken
  const lease = (): Lease => ({ token, expiresAt: new Date(Date.now() + LEASE_MS).toISOString() })

  return {
    async openDraft(): Promise<DraftSession> {
      return { token, lease: lease(), yaml: held, resumed: false }
    },
    async saveDraft(_token, next) {
      held = next
    },
    async renewLease() {
      return lease()
    },
    async publish(): Promise<PublishedVersion> {
      return { version: 1, publishedAt: now() }
    },
    async releaseDraft() {},
    async discardDraft() {},
    async listVersions(): Promise<Cursor<VersionSummary>> {
      return { items: [{ version: 1, status: 'draft', updatedAt: now() }], total: 1 }
    },
    async loadVersion() {
      return held
    },
  }
}
