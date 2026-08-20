import type { Manifest } from '@hatua/schema'
import type { ManifestState } from '@hatua/services'
import {
  type ComponentPropsWithRef,
  useEffect,
  useId,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react'
import { Button } from '../primitives/Button'
import { cx } from '../primitives/classNames'
import { Input } from '../primitives/Input'
import { useManifestStore } from '../theme/HatuaProvider'
import styles from './Library.module.css'
import css from './Library.module.css?inline'

export interface LibraryProps extends Omit<ComponentPropsWithRef<'section'>, 'onSelect'> {
  /**
   * Fired when a card is activated. Optional, and its absence is meaningful:
   * with no handler there is nothing a card can do, so the cards render as
   * cards rather than as buttons that swallow a click.
   *
   * Props out, not document state. Adding the Step is the editing store's job
   * (PR 4) and reaching for it here would mean guessing at its shape.
   */
  onSelect?: (manifest: Manifest) => void
  /** What the filter box starts with. Uncontrolled, like TabbedPanel's defaultTabId. */
  defaultQuery?: string
}

/**
 * The Library tab: the Components a Host's Component Manifests declare, ready
 * to be added to the Workflow Definition as Steps.
 *
 * It takes no manifests prop, and that is the decision this region turns on.
 * Both embeddings mount it bare — apps/playground/src/host.tsx writes
 * `<Library />` and layouts/regions.test.tsx renders every region with no
 * container above it — so the catalogue reaches it through <HatuaProvider>,
 * which carries the Host's ports and holds the store that reads them. The
 * region subscribes; it does not fetch, and it does not copy what it reads into
 * state of its own.
 *
 * What it deliberately does not do: add anything. `once: true` — at most one
 * instance per workflow — would grey out an already-used Component, and
 * knowing that needs the Workflow Definition, which arrives with the editing
 * store. Half of that check is worse than none, because the half that is
 * missing is the half a user notices. Dragging onto the canvas waits for the
 * canvas.
 */
export function Library({ onSelect, defaultQuery = '', className, ...rest }: LibraryProps) {
  const store = useManifestStore()
  const [query, setQuery] = useState(defaultQuery)
  const filterId = useId()

  // The one side effect: tell the store somebody is reading. It is idempotent,
  // so every region that mounts may call it and only the first fetches.
  useEffect(() => {
    store?.load()
  }, [store])

  const state = useSyncExternalStore<LibraryState>(
    store ? store.subscribe : subscribeToNothing,
    store ? store.getSnapshot : readUnconfigured,
    // Without a server snapshot this throws during SSR, and the whole package
    // is built to render there (ADR-0003). Loading is the honest answer: the
    // fetch is a client concern, so that is also what hydration matches.
    store ? readLoading : readUnconfigured,
  )

  const manifests = state.status === 'ready' ? state.manifests : NONE
  const sections = useMemo(() => sectionsOf(manifests, query), [manifests, query])
  const matched = sections.reduce((n, section) => n + section.count, 0)

  return (
    <>
      <style href="hatua-library" precedence="hatua">
        {css}
      </style>
      <section aria-label="Library" className={cx(styles.library, className)} {...rest}>
        {/* Only once there is something to filter. A search box over a failed
            load offers to narrow nothing. */}
        {state.status === 'ready' && manifests.length > 0 ? (
          <div className={styles.filter}>
            <label className={styles.filterLabel} htmlFor={filterId}>
              Filter
            </label>
            <Input
              id={filterId}
              type="search"
              value={query}
              placeholder="Search the library"
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        ) : null}

        <div className={styles.body}>
          {state.status === 'unconfigured' ? (
            <p className={styles.note}>
              No Component Manifests are wired up. A Host supplies them through{' '}
              <code className={styles.code}>{'<HatuaProvider ports={{ manifests }}>'}</code>.
            </p>
          ) : null}

          {/* role=status, not a spinner: the panel is a live region, so a
              screen reader hears the catalogue arrive rather than being left
              on a heading that never changes. */}
          {state.status === 'loading' ? (
            <p className={styles.note} role="status">
              Loading components…
            </p>
          ) : null}

          {state.status === 'failed' ? (
            <div className={styles.failure} role="alert">
              <p className={styles.failureText}>
                The Components could not be loaded. {state.error.message}
              </p>
              <Button size="sm" onClick={() => store?.reload()}>
                Try again
              </Button>
            </div>
          ) : null}

          {/* An empty catalogue is a state, not a fault: a Host that has
              declared nothing yet is exactly this, and saying so is what stops
              it being read as a failed load. */}
          {state.status === 'ready' && manifests.length === 0 ? (
            <p className={styles.note}>
              This Host has declared no Components yet. Everything the Library shows comes from its
              Component Manifests — Hatua invents none.
            </p>
          ) : null}

          {state.status === 'ready' && manifests.length > 0 && matched === 0 ? (
            <p className={styles.note} role="status">
              Nothing matches “{query}”.
            </p>
          ) : null}

          {sections.map((section) => (
            <div key={section.kind} className={styles.section}>
              <h2 className={styles.sectionHeading}>{section.heading}</h2>
              <p className={styles.sectionBlurb}>{section.blurb}</p>
              {section.groups.map((group) => (
                <div key={group.name} className={styles.group}>
                  <h3 className={styles.groupHeading}>{group.name}</h3>
                  <ul className={styles.cards}>
                    {group.manifests.map((manifest) => (
                      <li key={manifest.use}>
                        <Card manifest={manifest} onSelect={onSelect} />
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ))}
        </div>
      </section>
    </>
  )
}

/**
 * The component's icon, as the Host serves it.
 *
 * `icon` is a URL, not a name. Hatua ships no icon set and should not: a name
 * is only meaningful against a set, and a Host declaring a component of its own
 * would have nothing to name — which is how this field spent a release
 * resolving to nothing and the card drawing the component's initial instead. A
 * letter is not an icon; it carries no more than the name already beside it.
 *
 * Into a fixed box, `object-fit: contain`, so a Host's artwork cannot decide
 * the row height however it is proportioned.
 *
 * `referrerPolicy` because the URL may be a third party's CDN and the Host's
 * own URL can carry a workflow id. `alt=""` because the name is right there:
 * this is decoration, and announcing it twice helps nobody.
 */
function ComponentIcon({ manifest }: { manifest: Manifest }) {
  // The URL that failed, not a boolean, so the flag cannot outlive the URL it
  // was about. Cards are reconciled by `use`: were a catalogue ever to arrive
  // with a fixed icon on the same component, a bare `broken` flag would survive
  // the fix and keep drawing the placeholder for the life of the mount.
  //
  // No path reaches that today — every reload publishes `loading` first, which
  // empties the list and unmounts these cards, so the state resets on its own.
  // Written this way regardless: it costs a comparison, and it stops being
  // load-bearing on a store detail this component cannot see.
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const broken = failedUrl !== null && failedUrl === manifest.icon

  // A URL that 404s is the Host's to fix, and until it does the card still has
  // to draw something square. The placeholder is deliberately neutral rather
  // than a guess at what the icon would have been.
  if (!manifest.icon || broken) {
    return (
      <span className={styles.icon}>
        {/* No <title>: this is decoration inside an aria-hidden element, so a
            title would be announced to nobody and rendered as a hover tooltip
            to everybody — the same reason the Host's own icon files carry
            none. */}
        <svg
          className={styles.placeholder}
          viewBox="0 0 16 16"
          focusable="false"
          aria-hidden="true"
        >
          <rect x="2.5" y="2.5" width="11" height="11" rx="3" />
        </svg>
      </span>
    )
  }

  return (
    <span className={styles.icon}>
      <img
        className={styles.image}
        src={manifest.icon}
        alt=""
        width={18}
        height={18}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setFailedUrl(manifest.icon ?? null)}
      />
    </span>
  )
}

/**
 * A card is a button only when something happens on click. A control that does
 * nothing still takes a tab stop, still says "button" to a screen reader and
 * still invites a click — so the Host that mounts <Library /> to browse a
 * catalogue gets a list, and the one that passes onSelect gets controls.
 */
function Card({ manifest, onSelect }: { manifest: Manifest; onSelect?: (m: Manifest) => void }) {
  const body = (
    <>
      <ComponentIcon manifest={manifest} />
      <span className={styles.text}>
        <span className={styles.name}>{manifest.name}</span>
        {manifest.blurb ? <span className={styles.blurb}>{manifest.blurb}</span> : null}
      </span>
    </>
  )

  return onSelect ? (
    <button
      type="button"
      className={cx(styles.card, styles.actionable)}
      onClick={() => onSelect(manifest)}
    >
      {body}
    </button>
  ) : (
    <div className={styles.card}>{body}</div>
  )
}

/**
 * "The Host wired nothing" and "the Host declared nothing" are different
 * problems with different fixes, so they are different states. The store knows
 * only the second; this one exists between the provider and the region.
 */
type LibraryState = ManifestState | { status: 'unconfigured' }

const UNCONFIGURED = { status: 'unconfigured' } as const
const LOADING = { status: 'loading' } as const
const NONE: Manifest[] = []

// Module-level and therefore stable: useSyncExternalStore re-subscribes
// whenever `subscribe` changes identity, and re-renders forever if `getSnapshot`
// returns a fresh object each call.
const subscribeToNothing = () => () => {}
const readUnconfigured = (): LibraryState => UNCONFIGURED
const readLoading = (): LibraryState => LOADING

interface Group {
  name: string
  manifests: Manifest[]
}

interface Section {
  kind: Manifest['kind']
  heading: string
  blurb: string
  groups: Group[]
  count: number
}

/**
 * Triggers and Components are shown together but never mixed.
 *
 * CONTEXT.md is unambiguous: a Trigger is *not* a Step, and it lives in its own
 * section of the Workflow Definition. Its manifests are declared identically —
 * same `group`, same `icon`, same `blurb` — so grouping by `group` alone would
 * file `email.received` next to `email.send` under "Email" and present the two
 * as interchangeable things to add. They are not, and the difference is not
 * recoverable from anything on the card.
 *
 * Hiding Triggers was the other option and is worse. The Host declared them; a
 * Library that silently drops half of what it was handed sends whoever wrote
 * that manifest looking for a parse error. Separate headings show everything
 * and still say which is which, which is why this is a product decision rather
 * than a filter picked in passing.
 */
const SECTIONS = [
  {
    kind: 'trigger',
    heading: 'Triggers',
    blurb: 'What starts a workflow. A Trigger is not a Step — its outputs are the parameters.',
  },
  {
    kind: 'component',
    heading: 'Components',
    blurb: 'Added to the workflow as Steps.',
  },
] as const satisfies readonly { kind: Manifest['kind']; heading: string; blurb: string }[]

/** Free-form and optional, so everything unfiled lands together and last. */
const UNGROUPED = 'Other'

const matches = (manifest: Manifest, needle: string) =>
  [manifest.name, manifest.blurb, manifest.group, manifest.use].some((field) =>
    field?.toLowerCase().includes(needle),
  )

/**
 * Groups are kept in the order the Host declared them rather than sorted. The
 * manifest set is authored, and the order a Host wrote its catalogue in is the
 * only ordering information there is — alphabetising would discard it and put
 * "Advanced" above "Email" for no reason a user could name.
 */
function sectionsOf(manifests: Manifest[], query: string): Section[] {
  const needle = query.trim().toLowerCase()
  const visible = needle ? manifests.filter((m) => matches(m, needle)) : manifests

  return SECTIONS.flatMap(({ kind, heading, blurb }) => {
    const mine = visible.filter((m) => m.kind === kind)
    if (mine.length === 0) return []

    const groups = new Map<string, Manifest[]>()
    for (const manifest of mine) {
      const name = manifest.group?.trim() || UNGROUPED
      const existing = groups.get(name)
      if (existing) existing.push(manifest)
      else groups.set(name, [manifest])
    }

    // Whatever the Host left ungrouped goes last, wherever it happened to
    // appear: "Other" is not a section a Host chose, so it should not be able
    // to sit above the ones it did.
    const ordered = [...groups].sort(
      ([a], [b]) => Number(a === UNGROUPED) - Number(b === UNGROUPED),
    )

    return [
      {
        kind,
        heading,
        blurb,
        count: mine.length,
        groups: ordered.map(([name, list]) => ({ name, manifests: list })),
      },
    ]
  })
}
