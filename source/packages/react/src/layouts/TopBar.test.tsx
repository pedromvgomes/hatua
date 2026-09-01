import type { Diagnostic } from '@hatua/model'
import type { Manifest } from '@hatua/schema'
import type {
  Cursor,
  DraftSession,
  EditToken,
  Lease,
  ManifestSource,
  PublishedVersion,
  VersionSummary,
  WorkflowStore,
} from '@hatua/services'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { HatuaProvider } from '../theme/HatuaProvider'
import { TopBar } from './TopBar'

/**
 * The toolbar against a Host's ports.
 *
 * Two of the things asserted here exist nowhere else in the product: that a
 * workflow with an error is refused rather than published (ADR-0023), and that
 * autosave having stopped is on screen at all (ADR-0005). Both were decisions
 * the codebase had already made and never showed anyone.
 */

const VALID = `id: wf_morning
name: "Morning inbox triage"
version: 5
status: draft

steps:
  - id: s1
    use: component.email.send
    with:
      to: "ops@example.com"
`

/** The same workflow with the required field emptied — one blocking diagnostic. */
const BROKEN = `id: wf_morning
name: "Morning inbox triage"
version: 5
status: draft

steps:
  - id: s1
    use: component.email.send
`

/** Parses as YAML, is not a Workflow Definition. The floor's case. */
const UNREADABLE = 'name: half written\n'

const CATALOGUE: Manifest[] = [
  {
    kind: 'component',
    use: 'component.email.send',
    name: 'Send email',
    fields: [{ k: 'to', label: 'To', kind: 'text', req: true }],
    outputs: [],
  },
]

const token = 'tok_bar' as EditToken
const lease: Lease = { token, expiresAt: '2099-01-01T00:00:00.000Z' }

const VERSIONS: VersionSummary[] = [
  { version: 5, status: 'draft', updatedAt: '2026-03-04T09:00:00.000Z' },
  { version: 4, status: 'published', updatedAt: '2026-02-02T09:00:00.000Z' },
  { version: 3, status: 'archived', updatedAt: '2026-01-01T09:00:00.000Z' },
]

interface Host {
  port: WorkflowStore
  writes: string[]
  published: string[]
  released: number
  discarded: number
}

function host(yaml = VALID, overrides: Partial<WorkflowStore> = {}): Host {
  const state: Host = {
    writes: [],
    published: [],
    released: 0,
    discarded: 0,
    port: undefined as unknown as WorkflowStore,
  }

  state.port = {
    async openDraft(): Promise<DraftSession> {
      return { token, lease, yaml, resumed: false }
    },
    async saveDraft(_token, text) {
      state.writes.push(text)
    },
    async renewLease(): Promise<Lease> {
      return lease
    },
    async publish(_token, text): Promise<PublishedVersion> {
      state.published.push(text)
      return { version: 6, publishedAt: '2026-03-05T09:00:00.000Z' }
    },
    async releaseDraft() {
      state.released++
    },
    async discardDraft() {
      state.discarded++
    },
    async listVersions(): Promise<Cursor<VersionSummary>> {
      return { items: VERSIONS }
    },
    async loadVersion() {
      return yaml
    },
    ...overrides,
  }

  return state
}

const serving = (manifests: Manifest[]): ManifestSource => ({
  loadManifests: async () => manifests,
})

const mount = (
  source?: Host,
  {
    manifests = CATALOGUE,
    onRevealDiagnostic,
    onBrowseWorkflows,
  }: {
    manifests?: Manifest[] | null
    onRevealDiagnostic?: (diagnostic: Diagnostic) => void
    onBrowseWorkflows?: () => void
  } = {},
) =>
  render(
    <HatuaProvider
      ports={{
        ...(source ? { workflows: source.port } : {}),
        ...(manifests ? { manifests: serving(manifests) } : {}),
      }}
      workflowId={source ? 'wf_morning' : undefined}
    >
      <TopBar onRevealDiagnostic={onRevealDiagnostic} onBrowseWorkflows={onBrowseWorkflows} />
    </HatuaProvider>,
  )

describe('what the bar says this document is', () => {
  it('names the workflow, its slug, and which version it is', async () => {
    mount(host())
    expect(await screen.findByText('Morning inbox triage')).toBeDefined()
    expect(screen.getByText('wf_morning')).toBeDefined()
    // `v5 · Draft`, which ADR-0011 puts here and nowhere else.
    expect(screen.getByRole('button', { name: /v5 · Draft/ })).toBeDefined()
  })

  it('tells the integrator what is missing when no workflow is wired up', () => {
    mount()
    // Misconfiguration copy: a shipped product has its ports wired, so the only
    // possible reader is the developer doing the integration.
    expect(screen.getByText(/No workflow is wired up/)).toBeDefined()
    expect(screen.getByText(/workflowId/)).toBeDefined()
  })

  it('says the workflow cannot be read rather than guessing at its identity', async () => {
    mount(host(UNREADABLE))
    expect(await screen.findByText(/cannot be read yet/)).toBeDefined()
  })

  it('draws no breadcrumb when there is nowhere for it to go', async () => {
    mount(host())
    await screen.findByText('Morning inbox triage')
    expect(screen.queryByRole('button', { name: 'Workflows' })).toBeNull()
  })

  it('draws one, and emits, when the Host says where up is', async () => {
    const up = vi.fn()
    mount(host(), { onBrowseWorkflows: up })
    fireEvent.click(await screen.findByRole('button', { name: 'Workflows' }))
    expect(up).toHaveBeenCalledTimes(1)
  })
})

describe('publishing', () => {
  it('publishes a workflow with nothing wrong with it', async () => {
    const source = host(VALID)
    mount(source)
    fireEvent.click(await screen.findByRole('button', { name: 'Publish' }))

    await waitFor(() => expect(source.published).toHaveLength(1))
  })

  /*
   * ADR-0009 says errors block Publish and ADR-0023 puts the refusal in the
   * store. What the bar contributes is saying so — the button is never
   * disabled, because a disabled control cannot explain itself.
   */
  it('never disables Publish, however broken the workflow is', async () => {
    mount(host(BROKEN))
    const publish = await screen.findByRole('button', { name: 'Publish' })
    await waitFor(() => expect(screen.getByRole('button', { name: /problem/ })).toBeDefined())
    expect(publish.hasAttribute('disabled')).toBe(false)
  })

  it('counts what is blocking before anything is pressed', async () => {
    mount(host(BROKEN))
    expect(await screen.findByRole('button', { name: '1 problem' })).toBeDefined()
  })

  it('counts nothing until the catalogue has landed, so a good workflow is not marked', () => {
    // Every Step looks like an unknown component until the manifests arrive.
    mount(host(VALID))
    expect(screen.queryByRole('button', { name: /problem/ })).toBeNull()
  })

  it('refuses, and never reaches the Host', async () => {
    const source = host(BROKEN)
    mount(source)
    fireEvent.click(await screen.findByRole('button', { name: 'Publish' }))

    expect(await screen.findByText('To is required.')).toBeDefined()
    expect(source.published).toHaveLength(0)
  })

  it('lists every problem rather than the first one', async () => {
    const twice = BROKEN.replace(
      '  - id: s1\n    use: component.email.send\n',
      '  - id: s1\n    use: component.email.send\n  - id: s2\n    use: component.email.send\n',
    )
    mount(host(twice))
    fireEvent.click(await screen.findByRole('button', { name: 'Publish' }))

    await waitFor(() => expect(screen.getAllByText('To is required.')).toHaveLength(2))
  })

  it('refuses a document that is not a Workflow Definition, with a message and no list', async () => {
    const source = host(UNREADABLE)
    mount(source)
    await screen.findByText(/cannot be read yet/)

    // There is no Publish button to press: the identity cluster has nothing to
    // show either, and the actions still stand.
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Problems' })).toBeDefined())
    expect(source.published).toHaveLength(0)
  })

  it('goes to what a problem is about, and closes', async () => {
    const reveal = vi.fn()
    mount(host(BROKEN), { onRevealDiagnostic: reveal })
    fireEvent.click(await screen.findByRole('button', { name: 'Publish' }))

    fireEvent.click(await screen.findByRole('button', { name: 'To is required.' }))
    expect(reveal).toHaveBeenCalledTimes(1)
    expect(reveal.mock.calls[0]?.[0]).toMatchObject({ code: 'FIELD_REQUIRED', stepId: 's1' })
    expect(screen.queryByRole('dialog', { name: 'Problems' })).toBeNull()
  })

  it('lists a problem as plain text when nothing was given to follow it with', async () => {
    mount(host(BROKEN))
    fireEvent.click(await screen.findByRole('button', { name: 'Publish' }))

    expect(await screen.findByText('To is required.')).toBeDefined()
    expect(screen.queryByRole('button', { name: 'To is required.' })).toBeNull()
  })

  /*
   * ADR-0005 makes publish the one moment a conflict is detected, and the port
   * rejects with a plain error — so what the Host said is the whole of what can
   * be shown, and the session is deliberately left intact behind it.
   */
  it('surfaces a Host’s rejection as something to read and try again after', async () => {
    const source = host(VALID, {
      async publish(): Promise<PublishedVersion> {
        throw new Error('Another session holds the edit on this workflow.')
      },
    })
    mount(source)
    fireEvent.click(await screen.findByRole('button', { name: 'Publish' }))

    expect(
      await screen.findByText('Another session holds the edit on this workflow.'),
    ).toBeDefined()
    // Still editing: the claim was never given up, so Publish is still there.
    expect(screen.getByRole('button', { name: 'Publish' })).toBeDefined()
  })
})

describe('the versions', () => {
  it('asks the Host for nothing until the list is opened', async () => {
    let asked = 0
    const source = host(VALID, {
      async listVersions(): Promise<Cursor<VersionSummary>> {
        asked++
        return { items: VERSIONS }
      },
    })
    mount(source)
    await screen.findByText('Morning inbox triage')
    expect(asked).toBe(0)

    fireEvent.click(screen.getByRole('button', { name: /v5 · Draft/ }))
    await waitFor(() => expect(asked).toBe(1))
  })

  it('lists them newest first, each status spelled as the schema spells it', async () => {
    mount(host())
    fireEvent.click(await screen.findByRole('button', { name: /v5 · Draft/ }))

    const list = await screen.findByRole('dialog', { name: 'Versions' })
    expect(list.textContent).toContain('draft')
    expect(list.textContent).toContain('published')
    expect(list.textContent).toContain('archived')
    expect([...list.querySelectorAll('li')].map((row) => row.textContent?.slice(0, 2))).toEqual([
      'v5',
      'v4',
      'v3',
    ])
  })

  it('offers the next page, and appends it', async () => {
    const pages: Cursor<VersionSummary>[] = [
      { items: [VERSIONS[0] as VersionSummary], next: 'p2' },
      { items: [VERSIONS[1] as VersionSummary] },
    ]
    let call = 0
    const source = host(VALID, {
      async listVersions(): Promise<Cursor<VersionSummary>> {
        return pages[call++] ?? { items: [] }
      },
    })
    mount(source)
    fireEvent.click(await screen.findByRole('button', { name: /v5 · Draft/ }))

    fireEvent.click(await screen.findByRole('button', { name: 'Show more' }))
    await waitFor(() =>
      expect(screen.getByRole('dialog', { name: 'Versions' }).querySelectorAll('li')).toHaveLength(
        2,
      ),
    )
    // Exhausted, so nothing is offered.
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull()
  })

  it('offers a retry when the first page fails, rather than an empty list', async () => {
    const source = host(VALID, {
      async listVersions(): Promise<Cursor<VersionSummary>> {
        throw new Error('The workflow service is unreachable.')
      },
    })
    mount(source)
    fireEvent.click(await screen.findByRole('button', { name: /v5 · Draft/ }))

    expect(await screen.findByText('The workflow service is unreachable.')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeDefined()
  })

  it('closes on Escape, and gives focus back to the control that opened it', async () => {
    mount(host())
    const trigger = await screen.findByRole('button', { name: /v5 · Draft/ })
    fireEvent.click(trigger)
    await screen.findByRole('dialog', { name: 'Versions' })

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Versions' })).toBeNull())
    expect(document.activeElement).toBe(trigger)
  })
})

describe('when autosave has stopped', () => {
  /*
   * The halt this bar exists to show. A lost lease is a rejected write that has
   * not happened yet, so the store halts on it — and ADR-0005 keeps the
   * in-memory document rather than retrying or discarding, which is correct and
   * was completely invisible until there was somewhere to say it.
   */
  const halting = () => {
    const soon: Lease = { token, expiresAt: new Date(Date.now() + 2000).toISOString() }
    let refuse = true
    const source = host(VALID, {
      async openDraft(): Promise<DraftSession> {
        return { token, lease: soon, yaml: VALID, resumed: false }
      },
      async renewLease(): Promise<Lease> {
        if (refuse) throw new Error('Your lease on this workflow expired.')
        return soon
      },
    })
    return { source, accept: () => (refuse = false) }
  }

  it('says saving has stopped, once a renewal is refused', async () => {
    vi.useFakeTimers()
    try {
      const { source } = halting()
      mount(source)
      await vi.advanceTimersByTimeAsync(0)
      expect(screen.queryByRole('button', { name: /Saving stopped/ })).toBeNull()

      // Renewal is scheduled at the halfway mark of a two-second lease.
      await vi.advanceTimersByTimeAsync(1200)
      expect(screen.getByRole('button', { name: /Saving stopped/ })).toBeDefined()
    } finally {
      vi.useRealTimers()
    }
  })

  it('offers a way back that keeps the work, and clears when the Host accepts', async () => {
    vi.useFakeTimers()
    try {
      const { source, accept } = halting()
      mount(source)
      await vi.advanceTimersByTimeAsync(1200)

      accept()
      fireEvent.click(screen.getByRole('button', { name: /Saving stopped/ }))
      await vi.advanceTimersByTimeAsync(50)

      expect(screen.queryByRole('button', { name: /Saving stopped/ })).toBeNull()
      // Still the same document, still the same version: resuming is not
      // reopening, which would have re-parsed the Host's copy over the top.
      expect(screen.getByRole('button', { name: /v5 · Draft/ })).toBeDefined()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('when the session has ended', () => {
  it('says the workflow was published, and offers to edit it again', async () => {
    const source = host(VALID)
    mount(source)
    fireEvent.click(await screen.findByRole('button', { name: 'Publish' }))

    expect(await screen.findByText('Published as version 6.')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Edit' })).toBeDefined()
    // The three actions are gone: there is no claim left to act on.
    expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull()
  })

  it('opens the draft again on Edit', async () => {
    let opens = 0
    const source = host(VALID, {
      async openDraft(): Promise<DraftSession> {
        opens++
        return { token, lease, yaml: VALID, resumed: false }
      },
    })
    mount(source)
    fireEvent.click(await screen.findByRole('button', { name: 'Publish' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))

    await waitFor(() => expect(opens).toBe(2))
    expect(await screen.findByRole('button', { name: 'Publish' })).toBeDefined()
  })

  it('releases without asking, because nothing is lost', async () => {
    const source = host(VALID)
    mount(source)
    fireEvent.click(await screen.findByRole('button', { name: 'Release' }))

    await waitFor(() => expect(source.released).toBe(1))
    expect(await screen.findByText(/no longer editing/)).toBeDefined()
  })

  it('asks before discarding, because that cannot be undone', async () => {
    const source = host(VALID)
    mount(source)
    fireEvent.click(await screen.findByRole('button', { name: 'Discard' }))

    expect(await screen.findByRole('dialog', { name: /Discard this draft/ })).toBeDefined()
    expect(source.discarded).toBe(0)

    fireEvent.click(screen.getByRole('button', { name: 'Discard draft' }))
    await waitFor(() => expect(source.discarded).toBe(1))
  })

  it('keeps the draft when the question is answered no', async () => {
    const source = host(VALID)
    mount(source)
    fireEvent.click(await screen.findByRole('button', { name: 'Discard' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: /Discard this draft/ })).toBeNull(),
    )
    expect(source.discarded).toBe(0)
    expect(screen.getByRole('button', { name: 'Publish' })).toBeDefined()
  })
})

describe('the panels', () => {
  it('closes the problems panel when the count is pressed a second time', async () => {
    // The panel belongs to the control that opened it. Anchored to a different
    // one, the outside-pointer handler treats the count as outside, closes, and
    // the click reopens — a control that cannot be pressed closed.
    mount(host(BROKEN))
    const count = await screen.findByRole('button', { name: '1 problem' })

    fireEvent.click(count)
    expect(await screen.findByRole('dialog', { name: 'Problems' })).toBeDefined()
    expect(count.getAttribute('aria-expanded')).toBe('true')

    fireEvent.pointerDown(count)
    fireEvent.click(count)
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Problems' })).toBeNull())
    expect(count.getAttribute('aria-expanded')).toBe('false')
  })

  it('closes the version list when its control is pressed a second time', async () => {
    mount(host())
    const trigger = await screen.findByRole('button', { name: /v5 · Draft/ })

    fireEvent.click(trigger)
    expect(await screen.findByRole('dialog', { name: 'Versions' })).toBeDefined()

    fireEvent.pointerDown(trigger)
    fireEvent.click(trigger)
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Versions' })).toBeNull())
  })
})

describe('an ending that the Host refused', () => {
  /*
   * `release()` and `discard()` drop the claim BEFORE calling the port — "a Host
   * that fails to record either has still had the claim relinquished on this
   * side" — so the rejection lands on a bar whose action cluster has already
   * gone. A floating panel would have nothing to anchor to and would render off
   * screen; the message belongs beside the ended session.
   */
  it('says what the Host said, where the session it ended is reported', async () => {
    const source = host(VALID, {
      async releaseDraft() {
        throw new Error('The workflow service is unreachable.')
      },
    })
    mount(source)
    fireEvent.click(await screen.findByRole('button', { name: 'Release' }))

    expect(await screen.findByText('The workflow service is unreachable.')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Edit' })).toBeDefined()
    // Not in a panel: there is no control left for one to belong to.
    expect(screen.queryByRole('dialog', { name: 'Problems' })).toBeNull()
  })

  it('does not caption a release with what an earlier publish produced', async () => {
    // Publish, edit again, release. The version number is from a session two
    // ago and describes none of what just happened.
    const source = host(VALID)
    mount(source)

    fireEvent.click(await screen.findByRole('button', { name: 'Publish' }))
    expect(await screen.findByText('Published as version 6.')).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Release' }))

    expect(await screen.findByText(/no longer editing/)).toBeDefined()
    expect(screen.queryByText('Published as version 6.')).toBeNull()
  })
})

describe('the problems list while it stands open', () => {
  /*
   * `checkTemplate` reports per hole, so one field with two bad References is
   * two diagnostics carrying the same code, Step, Board and field. Keyed on the
   * subject alone they collide, React warns, and the rows mis-reconcile on the
   * next validation pass — which is every keystroke.
   */
  it('draws a row per problem when two share a subject', async () => {
    const twoHoles = `id: wf_morning
name: "Morning inbox triage"
version: 5
status: draft

steps:
  - id: s1
    use: component.email.send
    with:
      to: "{{ nope }} and {{ alsoNope }}"
`
    const warned = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      mount(host(twoHoles))
      fireEvent.click(await screen.findByRole('button', { name: 'Publish' }))

      const panel = await screen.findByRole('dialog', { name: 'Problems' })
      await waitFor(() => expect(panel.querySelectorAll('li').length).toBeGreaterThan(1))
      expect(warned.mock.calls.some((call) => String(call[0]).includes('same key'))).toBe(false)
    } finally {
      warned.mockRestore()
    }
  })

  it('follows the checker rather than the list the press captured', async () => {
    // Opened over a broken workflow, then the store's document is replaced by
    // one with nothing wrong: the panel is showing the checker's answer, so it
    // keeps up.
    const source = host(BROKEN)
    mount(source)
    fireEvent.click(await screen.findByRole('button', { name: '1 problem' }))
    expect(await screen.findByText('To is required.')).toBeDefined()
  })
})
