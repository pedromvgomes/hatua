import type { Manifest, ManifestEntry } from '@hatua/schema'
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
import styles from './Components.module.css'
import css from './Components.module.css?inline'

export interface ComponentsProps extends Omit<ComponentPropsWithRef<'section'>, 'onSelect'> {
  /**
   * Fired when a card is activated. Optional, and its absence is meaningful:
   * with no handler there is nothing a card can do, so the cards render as
   * cards rather than as buttons that swallow a click.
   *
   * Props out, not document state. Adding the Step is the editing store's job,
   * and reaching for it here would tie the catalogue to the tree.
   */
  onSelect?: (manifest: Manifest) => void
  /** What the filter box starts with. Uncontrolled, like TabbedPanel's defaultTabId. */
  defaultQuery?: string
}

/**
 * The Components tab: the Components a Host's Component Manifests declare,
 * ready to be added to the Workflow Definition as Steps.
 *
 * **Components and nothing else.** A catalogue serves two `kind`s and this
 * region renders one, because adding a Trigger belongs to the Workflow tab: a
 * Trigger is not a Step (CONTEXT.md), `doc.triggers[]` is a top-level list, and
 * a card here means "add this to the tree". A tab headed Components that also
 * offered Triggers would present the two as interchangeable things to add, and
 * nothing on a card distinguishes them — the manifests are declared
 * identically, same `group`, same `icon`, same `blurb`.
 *
 * The label and the region are one word for the same reason. `Build.tsx` and
 * `layouts/regions.test.tsx` both record what happened when a tab labelled
 * "Flow" and a region called `FlowMap` drifted apart — two different things
 * wearing one name, and a canvas with nowhere to live.
 *
 * It takes no manifests prop, and that is the decision this region turns on.
 * Both embeddings mount it bare — apps/playground/src/host.tsx writes
 * `<Components />` and layouts/regions.test.tsx renders every region with no
 * container above it — so the catalogue reaches it through <HatuaProvider>,
 * which carries the Host's ports and holds the store that reads them. The
 * region subscribes; it does not fetch, and it does not copy what it reads into
 * state of its own.
 *
 * What it deliberately does not do: add anything. `once: true` — at most one
 * instance per workflow — would grey out an already-used Component, and knowing
 * that needs the Workflow Definition. Half of that check is worse than none,
 * because the half that is missing is the half a user notices. Dragging onto
 * the canvas waits for the canvas.
 */
export function Components({ onSelect, defaultQuery = '', className, ...rest }: ComponentsProps) {
  const store = useManifestStore()
  const [query, setQuery] = useState(defaultQuery)
  const filterId = useId()

  // The one side effect: tell the store somebody is reading. It is idempotent,
  // so every region that mounts may call it and only the first fetches.
  useEffect(() => {
    store?.load()
  }, [store])

  const state = useSyncExternalStore<CatalogueState>(
    store ? store.subscribe : subscribeToNothing,
    store ? store.getSnapshot : readUnconfigured,
    // Without a server snapshot this throws during SSR, and the whole package
    // is built to render there (ADR-0003). Loading is the honest answer: the
    // fetch is a client concern, so that is also what hydration matches.
    store ? readLoading : readUnconfigured,
  )

  const manifests = state.status === 'ready' ? state.manifests : NONE
  const components = useMemo(
    () => manifests.filter((entry): entry is Manifest => kindOf(entry) === 'component'),
    [manifests],
  )
  const groups = useMemo(() => groupsOf(components, query), [components, query])
  const matched = groups.reduce((n, group) => n + group.manifests.length, 0)

  const searching = query.trim() !== ''
  const ready = state.status === 'ready'
  /**
   * An entry whose `kind` is neither of the two a manifest declares. A
   * `components:` catalogue resolved one array too shallow is exactly this, and
   * it is a wiring mistake rather than an empty catalogue — different fix,
   * different audience, so different copy.
   */
  const undeclared = ready && manifests.some((manifest) => !KINDS.has(kindOf(manifest) ?? ''))
  /** Loaded and correctly shaped, and there is simply no Component in it. */
  const none = ready && components.length === 0 && !undeclared

  const liveMessage =
    state.status === 'loading'
      ? 'Loading components…'
      : components.length > 0 && matched === 0 && searching
        ? `Nothing matches “${query}”.`
        : ''

  return (
    <>
      <style href="hatua-components" precedence="hatua">
        {css}
      </style>
      <section aria-label="Components" className={cx(styles.components, className)} {...rest}>
        {/* Only once there is something to filter. A search box over a failed
            load offers to narrow nothing. */}
        {components.length > 0 ? (
          <div className={styles.filter}>
            <label className={styles.filterLabel} htmlFor={filterId}>
              Filter
            </label>
            <Input
              id={filterId}
              type="search"
              value={query}
              placeholder="Search components"
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

          {/*
            One live region, mounted for the life of the panel, whatever it
            currently has to say.

            Rendered conditionally it announced nothing much of the time: a live
            region generally has to EXIST before its content changes for the
            change to be announced, so a <p role="status"> inserted together
            with "Loading components…" is a new node rather than an update to a
            watched one. Mounted always and written into, "the catalogue
            arrived" is a change a screen reader is actually watching for.
          */}
          <p className={cx(styles.note, !liveMessage && styles.silent)} role="status">
            {liveMessage}
          </p>

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

          {/*
            An end user's screen, so it is said in their words. Nothing about
            manifests, and nothing about a Host: a workflow builder with no
            components in it yet is a state a correctly-wired product has, and
            the person looking at it cannot act on a sentence about files they
            do not own. See .agents/rules/rendered-copy-is-written-for-the-hosts-users.md.

            One sentence covers both ways of getting here — a catalogue with
            nothing in it, and one holding only Triggers — because they are the
            same answer to the same question.
          */}
          {none ? <p className={styles.note}>No components are available yet.</p> : null}

          {/* The other half: entries the catalogue declared and this region
              cannot read. Only a wiring mistake produces it, so it names the
              key that fixes it. */}
          {undeclared && matched === 0 ? (
            <p className={styles.note}>
              The catalogue loaded, but nothing in it is a Component. A manifest declares which with{' '}
              <code className={styles.code}>kind</code>.
            </p>
          ) : null}

          {groups.map((group) => (
            <div key={group.name} className={styles.group}>
              <h2 className={styles.groupHeading}>{group.name}</h2>
              <ul className={styles.cards}>
                {group.manifests.map((manifest, index) => (
                  // `use` is the identity, and is what this key is — except for
                  // an entry the Host malformed badly enough to have none,
                  // where its place in the group is the only identity there is.
                  <li key={textOf(manifest.use) ?? `${group.name}:${index}`}>
                    <Card manifest={manifest} onSelect={onSelect} />
                  </li>
                ))}
              </ul>
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
  const icon = textOf(manifest?.icon)
  const broken = failedUrl !== null && failedUrl === icon

  // A URL that 404s is the Host's to fix, and until it does the card still has
  // to draw something square. The placeholder is deliberately neutral rather
  // than a guess at what the icon would have been.
  if (!icon || broken) {
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
        src={icon}
        alt=""
        width={18}
        height={18}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setFailedUrl(icon)}
      />
    </span>
  )
}

/**
 * A card is a button only when something happens on click. A control that does
 * nothing still takes a tab stop, still says "button" to a screen reader and
 * still invites a click — so the Host that mounts <Components /> to browse a
 * catalogue gets a list, and the one that passes onSelect gets controls.
 */
function Card({ manifest, onSelect }: { manifest: Manifest; onSelect?: (m: Manifest) => void }) {
  // A card with no name still draws, because dropping it would leave a Host
  // debugging a catalogue by counting rows that are not there. The verb is the
  // fallback, since it is what a Step would be written with.
  const name = textOf(manifest.name) ?? textOf(manifest.use) ?? 'Unnamed component'
  const blurb = textOf(manifest.blurb)

  const body = (
    <>
      <ComponentIcon manifest={manifest} />
      <span className={styles.text}>
        <span className={styles.name}>{name}</span>
        {blurb ? <span className={styles.blurb}>{blurb}</span> : null}
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
type CatalogueState = ManifestState | { status: 'unconfigured' }

const UNCONFIGURED = { status: 'unconfigured' } as const
const LOADING = { status: 'loading' } as const
const NONE: ManifestEntry[] = []

/**
 * The kinds an entry may declare. Anything else is a malformed catalogue.
 *
 * `context` is in the set and is not a Component: the Host's Run Context
 * declaration travels in the same flat array, and this region rendering nothing
 * for it is correct rather than a mistake to report. What the set is for is
 * telling *that* apart from an entry whose kind is a typo or absent, which no
 * region can render and which names a fix only the integrator can make.
 */
const KINDS: ReadonlySet<string> = new Set<ManifestEntry['kind']>([
  'component',
  'trigger',
  'context',
])

/**
 * An entry's `kind`, or undefined when the entry is not even an object.
 *
 * The store validates the outer array and deliberately not each entry —
 * `manifests.ts` argues that validating every one "would turn one malformed
 * entry into an empty catalogue". The cost of that decision lands here: this
 * region is handed whatever the Host resolved, so `entry.kind` may be reading a
 * property of `null`. A TypeError from render takes down the Host's tree, which
 * is the outcome the `failed` state exists to avoid — so a junk entry is
 * something this region files under "not a Component" and reports, never
 * something it dereferences.
 */
const kindOf = (entry: ManifestEntry): string | undefined =>
  entry && typeof entry === 'object' && typeof entry.kind === 'string' ? entry.kind : undefined

/** The card's text, only where the Host actually supplied a string. */
const textOf = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined

// Module-level and therefore stable: useSyncExternalStore re-subscribes
// whenever `subscribe` changes identity, and re-renders forever if `getSnapshot`
// returns a fresh object each call.
const subscribeToNothing = () => () => {}
const readUnconfigured = (): CatalogueState => UNCONFIGURED
const readLoading = (): CatalogueState => LOADING

interface Group {
  name: string
  manifests: Manifest[]
}

/** Free-form and optional, so everything unfiled lands together and last. */
const UNGROUPED = 'Other'

const matches = (manifest: Manifest, needle: string) =>
  [manifest.name, manifest.blurb, manifest.group, manifest.use].some((field) =>
    textOf(field)?.toLowerCase().includes(needle),
  )

/**
 * Groups are kept in the order the Host declared them rather than sorted. The
 * manifest set is authored, and the order a Host wrote its catalogue in is the
 * only ordering information there is — alphabetising would discard it and put
 * "Advanced" above "Email" for no reason a user could name.
 */
function groupsOf(components: Manifest[], query: string): Group[] {
  const needle = query.trim().toLowerCase()
  const visible = needle ? components.filter((m) => matches(m, needle)) : components

  const groups = new Map<string, Manifest[]>()
  for (const manifest of visible) {
    const name = textOf(manifest.group)?.trim() || UNGROUPED
    const existing = groups.get(name)
    if (existing) existing.push(manifest)
    else groups.set(name, [manifest])
  }

  // Whatever the Host left ungrouped goes last, wherever it happened to appear:
  // "Other" is not a section a Host chose, so it should not be able to sit
  // above the ones it did.
  return [...groups]
    .sort(([a], [b]) => Number(a === UNGROUPED) - Number(b === UNGROUPED))
    .map(([name, manifests]) => ({ name, manifests }))
}
