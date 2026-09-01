import type { ManifestEntry } from '@hatua/schema'
import {
  type Cursor,
  type DraftSession,
  type EditToken,
  type Lease,
  type ManifestSource,
  type PublishedVersion,
  setWorkflowName,
  type VersionSummary,
  type WorkflowStore,
} from '@hatua/services'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { type ReactNode, useEffect, useRef } from 'react'
import { useEditingStore } from '../theme/HatuaProvider'
import { TopBar } from './TopBar'

/**
 * Every state the toolbar has, against a fake WorkflowStore and a fake
 * ManifestSource.
 *
 * Two of them exist nowhere else in the product. **Blocked** is ADR-0009's
 * "errors block Publish" with something on screen saying so, and **SavingStopped**
 * is ADR-0005's halted autosave — a decision the codebase had already made and
 * never showed anyone.
 */

const SOURCE = `id: wf_morning
name: "Morning inbox triage"
version: 5
status: draft

steps:
  - id: s1
    use: component.email.send
    name: "Send the digest"
    with:
      to: "ops@example.com"
`

/** The same workflow with a required field left empty — one blocking diagnostic. */
const BLOCKED = `id: wf_morning
name: "Morning inbox triage"
version: 5
status: draft

steps:
  - id: s1
    use: component.email.send
    name: "Send the digest"
  - id: s2
    use: component.email.send
    name: "Tell the on-call"
`

/** A workflow whose live version is published and which nobody is drafting. */
const PUBLISHED = `id: wf_morning
name: "Morning inbox triage"
version: 4
status: published

steps:
  - id: s1
    use: component.email.send
    name: "Send the digest"
    with:
      to: "ops@example.com"
`

/**
 * A name and a slug that will not fit.
 *
 * The left cluster is what has to give: it truncates and keeps its `title`,
 * because the alternative is pushing Publish off the end of a bar that is
 * already dense at the 1240px floor.
 */
const LONG = `id: wf_overnight_inbox_triage_and_escalation_pipeline_v2
name: "Overnight inbox triage, escalation and weekly digest pipeline"
version: 5
status: draft

steps:
  - id: s1
    use: component.email.send
    name: "Send the digest"
    with:
      to: "ops@example.com"
`

const CATALOGUE: ManifestEntry[] = [
  {
    kind: 'component',
    use: 'component.email.send',
    name: 'Send email',
    fields: [{ k: 'to', label: 'To', kind: 'text', req: true }],
    outputs: [],
  },
]

const token = 'tok_story' as EditToken
const lease: Lease = { token, expiresAt: '2099-01-01T00:00:00.000Z' }

const HISTORY: VersionSummary[] = [
  { version: 5, status: 'draft', updatedAt: '2026-03-04T09:12:00.000Z' },
  { version: 4, status: 'published', updatedAt: '2026-02-19T16:40:00.000Z' },
  { version: 3, status: 'archived', updatedAt: '2026-01-28T11:05:00.000Z' },
  { version: 2, status: 'archived', updatedAt: '2026-01-14T08:30:00.000Z' },
  { version: 1, status: 'archived', updatedAt: '2025-12-02T14:20:00.000Z' },
]

const serving = (yaml: string, overrides: Partial<WorkflowStore> = {}): WorkflowStore => ({
  async openDraft(): Promise<DraftSession> {
    return { token, lease, yaml, resumed: false }
  },
  async saveDraft() {},
  async renewLease(): Promise<Lease> {
    return lease
  },
  async publish(): Promise<PublishedVersion> {
    return { version: 6, publishedAt: '2026-03-05T09:00:00.000Z' }
  },
  async releaseDraft() {},
  async discardDraft() {},
  async listVersions(): Promise<Cursor<VersionSummary>> {
    return { items: HISTORY, total: HISTORY.length }
  },
  async loadVersion() {
    return yaml
  },
  ...overrides,
})

const catalogue = (manifests: ManifestEntry[]): ManifestSource => ({
  loadManifests: async () => manifests,
})

const wired = (store: WorkflowStore, manifests: ManifestEntry[] | null = CATALOGUE) => ({
  ports: {
    workflows: store,
    ...(manifests ? { manifests: catalogue(manifests) } : {}),
  },
  workflowId: 'wf_morning',
})

/**
 * Presses a control once the region has drawn it.
 *
 * Some of what this bar does only exists after somebody has pressed something —
 * the version list, the problems panel, the ended session. A story that could
 * not reach those would be a story of half the region, and there is no
 * interaction runner in this Storybook to reach them with.
 *
 * It polls rather than pressing once, because the control it wants does not
 * exist until the Draft has opened, and a fake port still resolves a tick later
 * than the first paint.
 */
function Presses({ label, children }: { label: RegExp; children: ReactNode }) {
  const host = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>

    const tick = () => {
      if (cancelled) return
      const found = [...(host.current?.querySelectorAll('button') ?? [])].find((button) =>
        label.test(button.textContent ?? ''),
      )
      if (found) {
        found.click()
        return
      }
      timer = setTimeout(tick, 25)
    }

    tick()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [label])

  return <div ref={host}>{children}</div>
}

/**
 * Makes one edit, which is the only way autosave has anything to do.
 *
 * The toolbar edits nothing itself — the Workflow tab is where a name is
 * changed — so a story about a write in flight has to make one happen.
 */
function Edits({ children }: { children: ReactNode }) {
  const store = useEditingStore()

  useEffect(() => {
    if (!store) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>

    const tick = () => {
      if (cancelled) return
      if (store.getSnapshot().status === 'ready') {
        store.apply(setWorkflowName('Morning inbox triage, revised'))
        return
      }
      timer = setTimeout(tick, 25)
    }

    tick()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [store])

  return children
}

const meta = {
  title: 'Layouts/TopBar',
  component: TopBar,
  decorators: [
    (Story) => (
      <div style={{ inlineSize: '100%', border: '1px solid var(--hatua-border-subtle)' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof TopBar>

export default meta
type Story = StoryObj<typeof meta>

/**
 * A Draft with nothing wrong with it: the identity on the left, the three
 * decisions on the right, and no count — because there is nothing to count.
 */
export const CleanDraft: Story = {
  parameters: wired(serving(SOURCE)),
}

/**
 * The same bar over a workflow the checker refuses. The count is on screen
 * before anything is pressed, and **Publish** is not disabled: ADR-0023 puts the
 * refusal in the store, so the button stays live and answers.
 */
export const Blocked: Story = {
  parameters: wired(serving(BLOCKED)),
}

/**
 * What pressing **Publish** on that workflow gets you. Every problem, not the
 * first — a user fixing one field at a time is a user pressing Publish five
 * times to find five mistakes.
 */
export const BlockedAndOpened: Story = {
  parameters: wired(serving(BLOCKED)),
  decorators: [
    (Story) => (
      <Presses label={/problem/}>
        <Story />
      </Presses>
    ),
  ],
}

/**
 * The Host says no. `WorkflowStore.publish` rejects with a plain error, so what
 * it said is the whole of what can be shown — ADR-0005 makes this the one moment
 * a conflict is detected, and the session is deliberately left running behind it.
 */
export const RejectedByTheHost: Story = {
  parameters: wired(
    serving(SOURCE, {
      async publish(): Promise<PublishedVersion> {
        throw new Error('Someone else published version 5 while you were editing.')
      },
    }),
  ),
  decorators: [
    (Story) => (
      <Presses label={/^Publish$/}>
        <Story />
      </Presses>
    ),
  ],
}

/**
 * A write in the air. Shown while one is outstanding and nothing at all once it
 * lands — the handoff refuses a **Save changes** button and the flag behind it,
 * which is a rule about the steady state rather than about a write in progress.
 */
export const Saving: Story = {
  parameters: wired(
    serving(SOURCE, {
      // Never settles, so the story holds the state rather than flashing it.
      saveDraft: () => new Promise<void>(() => {}),
    }),
  ),
  decorators: [
    (Story) => (
      <Edits>
        <Story />
      </Edits>
    ),
  ],
}

/**
 * Autosave has stopped and the work is still here (ADR-0005).
 *
 * The lease was lost, which is a rejected write that has not happened yet — so
 * the store halts rather than finding out the expensive way. The control resumes
 * saving on the claim still held; it does not reopen, which would re-parse the
 * Host's copy over the top of the user's work.
 */
export const SavingStopped: Story = {
  parameters: wired(
    serving(SOURCE, {
      async openDraft(): Promise<DraftSession> {
        return {
          token,
          // Short, so the renewal below is attempted while the story is watched.
          lease: { token, expiresAt: new Date(Date.now() + 2500).toISOString() },
          yaml: SOURCE,
          resumed: false,
        }
      },
      async renewLease(): Promise<Lease> {
        throw new Error('Your lease on this workflow expired.')
      },
    }),
  ),
}

/** The list, on a workflow whose whole history fits in one page. */
export const VersionsOnOnePage: Story = {
  parameters: wired(
    serving(SOURCE, {
      async listVersions(): Promise<Cursor<VersionSummary>> {
        return { items: HISTORY.slice(0, 3), total: 3 }
      },
    }),
  ),
  decorators: [
    (Story) => (
      <Presses label={/v5/}>
        <Story />
      </Presses>
    ),
  ],
}

/**
 * A page in, with more behind it. `drain` is the wrong tool for this list — its
 * own header explains that it throws past a limit rather than truncating, and a
 * workflow published daily for three years is the case that reaches it.
 */
export const VersionsMidPage: Story = {
  parameters: wired(
    serving(SOURCE, {
      async listVersions(_workflowId, cursor): Promise<Cursor<VersionSummary>> {
        if (cursor === undefined) return { items: HISTORY.slice(0, 2), next: '3', total: 5 }
        return { items: HISTORY.slice(2, 4), next: '1', total: 5 }
      },
    }),
  ),
  decorators: [
    (Story) => (
      <Presses label={/v5/}>
        <Story />
      </Presses>
    ),
  ],
}

/** The last page: everything is loaded, so nothing more is offered. */
export const VersionsLastPage: Story = {
  parameters: wired(
    serving(SOURCE, {
      async listVersions(): Promise<Cursor<VersionSummary>> {
        return { items: HISTORY, total: HISTORY.length }
      },
    }),
  ),
  decorators: [
    (Story) => (
      <Presses label={/v5/}>
        <Story />
      </Presses>
    ),
  ],
}

/**
 * A published version with no Draft open. The readout says which version is on
 * screen and what it is, which is the whole of what ADR-0011 puts here.
 */
export const PublishedNoDraft: Story = {
  parameters: wired(serving(PUBLISHED)),
}

/**
 * The session is over — released, here, but publishing and discarding end it
 * the same way. A screen that still looked live would be one whose next
 * keystroke went nowhere, so the bar says so and offers the way back in.
 */
export const SessionEnded: Story = {
  parameters: wired(serving(SOURCE)),
  decorators: [
    (Story) => (
      <Presses label={/^Release$/}>
        <Story />
      </Presses>
    ),
  ],
}

/**
 * A long name and a long slug against a fixed left cluster. Both truncate and
 * both keep a `title`, so the three actions on the right keep their room.
 */
export const LongIdentity: Story = {
  parameters: wired(serving(LONG)),
}

/**
 * The Host wired storage and no catalogue. Nothing can be checked, so nothing is
 * counted — and **Publish** still works, on the floor alone: a document that does
 * not project is refused whatever else is missing (ADR-0023).
 */
export const NoCatalogue: Story = {
  parameters: wired(serving(SOURCE), null),
}

/**
 * A document that parses as YAML and is not a Workflow Definition — what
 * someone halfway through Text Mode has. The name, the slug and the version are
 * unreadable at once, and the bar says so rather than showing the last ones it
 * saw.
 */
export const UnreadableDocument: Story = {
  parameters: wired(serving('name: half written\n')),
}

/**
 * Nothing wired up at all. Misconfiguration copy: a shipped product has its
 * ports wired, so the only possible reader is the developer doing the
 * integration — which is why this one names Hatua and the prop.
 */
export const NotWiredUp: Story = {}
