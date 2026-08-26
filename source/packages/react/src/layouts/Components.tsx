import {
  BLOCK_PREFIX,
  callSitesOf,
  contractSummary,
  type Diagnostic,
  walkSteps,
} from '@hatua/model'
import type { Block, Manifest, ManifestEntry, WorkflowDefinition } from '@hatua/schema'
import {
  addBlock,
  type EditingState,
  type ManifestState,
  nextBlockId,
  removeBlock,
  type ValidationState,
} from '@hatua/services'
import {
  type ComponentPropsWithRef,
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react'
import { Button } from '../primitives/Button'
import { ConfirmDialog } from '../primitives/ConfirmDialog'
import { cx } from '../primitives/classNames'
import { Input } from '../primitives/Input'
import { useEditingStore, useManifestStore, useValidationStore } from '../theme/HatuaProvider'
import { setDragChip } from '../units/dragChip'
import { IconCoin } from '../units/IconCoin'
import { RemoveButton } from '../units/RemoveButton'
import styles from './Components.module.css'
import css from './Components.module.css?inline'
import { COMPONENT_MIME, type ComponentDrag, encodeComponent } from './dragging'

export interface ComponentsProps extends Omit<ComponentPropsWithRef<'section'>, 'onSelect'> {
  /**
   * Fired when a card is activated. Optional, and its absence is meaningful:
   * with no handler there is nothing a card can do, so the cards render as
   * cards rather than as buttons that swallow a click.
   *
   * Props out, not document state. Adding the Step is the editing store's job,
   * and reaching for it here would tie the catalogue to the tree.
   *
   * **The verb and the name, not the manifest.** Two of the three roots of the
   * verb namespace are listed here — a Host's Components and this document's
   * Blocks (CONTEXT.md) — and a Block has no manifest to hand back. What both
   * kinds of card have is what writes the Step: the verb, and what to call it.
   * That is the same payload the drag carries, so the two gestures cannot
   * disagree about what was picked.
   */
  onSelect?: (component: ComponentDrag) => void
  /**
   * Fired when a Block's Board should come forward — one just declared here, or
   * one whose card's Open was pressed.
   *
   * ADR-0017: a Block's tab opens when the Block is declared, and when a call
   * site is opened. Which Board is on screen is chrome and this region does not
   * hold it, so both are reported rather than acted on.
   *
   * Without a handler a Block that nothing calls has no Board a user can reach:
   * the strip lists only Boards already open, and the canvas's own doorway is on
   * a call site. That is the state this closes, so a caller that lists Blocks
   * and ignores this leaves a Block that can be declared and never opened.
   */
  onBoardOpen?: (block: string) => void
  /**
   * A place on the canvas is waiting for a Component, so the panel says so.
   *
   * A boolean and not the point itself: this region has no tree to resolve one
   * against, and where the next Step lands is already the caller's answer —
   * `onSelect` says which Component and nothing about where. All this needs to
   * know is that the next card picked is going somewhere chosen, because
   * otherwise choosing it is a click with no visible consequence.
   */
  pending?: boolean
  /** What the filter box starts with. Uncontrolled, like TabbedPanel's defaultTabId. */
  defaultQuery?: string
}

/**
 * The Components tab: everything a Step can be, ready to be added to the
 * Workflow Definition.
 *
 * ## Two roots, one tab
 *
 * A verb's root says who declares it (CONTEXT.md): `component.email.send` is a
 * Host's and `block.archive_entry` is this document's. Both are Components by
 * the domain's own definition, so both are cards here, and a card does the same
 * thing whichever root it carries — click it or drag it onto the canvas and the
 * Step it becomes is written with its verb.
 *
 * The Blocks are a section of their own rather than another entry in
 * `groupsOf`. A Host's groups are ordered as the Host declared them and this is
 * not one the Host chose, so it neither joins that ordering nor displaces it;
 * it goes first because it is the section the user authored and the only one
 * carrying a control that creates something.
 *
 * ## What it edits, and what it only reports
 *
 * Declaring a Block and removing one are edits and go through the editing store
 * as commands, the way every edit on the Workflow tab does. Which Board is on
 * screen is chrome this region does not hold, so opening one is a prop out.
 *
 * Nothing here restates the document's own states. A Host that wired no
 * storage, a Draft still opening, a file that does not project — the Workflow
 * tab says all three, and a second copy in this panel would be two sentences
 * about one problem. The Blocks section is simply absent until there is a
 * document to read.
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
 * What it deliberately does not do: mark a Host's Component as already used.
 * `once: true` — at most one instance per workflow — would grey one out, and
 * half of that check is worse than none, because the half that is missing is
 * the half a user notices.
 */
export function Components({
  onSelect,
  onBoardOpen,
  pending = false,
  defaultQuery = '',
  className,
  ...rest
}: ComponentsProps) {
  const store = useManifestStore()
  const editing = useEditingStore()
  const validation = useValidationStore()
  const [query, setQuery] = useState(defaultQuery)
  /** The Block a confirmation is standing in front of, and what it costs. */
  const [confirming, setConfirming] = useState<Cost | null>(null)
  const filterId = useId()

  // The one side effect: tell each store somebody is reading. Both are
  // idempotent, so every region that mounts may call them and only the first
  // fetches the catalogue or opens the Draft.
  useEffect(() => {
    store?.load()
    editing?.open()
  }, [store, editing])

  const state = useSyncExternalStore<CatalogueState>(
    store ? store.subscribe : subscribeToNothing,
    store ? store.getSnapshot : readUnconfigured,
    // Without a server snapshot this throws during SSR, and the whole package
    // is built to render there (ADR-0003). Loading is the honest answer: the
    // fetch is a client concern, so that is also what hydration matches.
    store ? readLoading : readUnconfigured,
  )

  const document = useSyncExternalStore<DocumentState>(
    editing ? editing.subscribe : subscribeToNothing,
    editing ? editing.getSnapshot : readUnopened,
    editing ? readOpening : readUnopened,
  )

  const checks = useSyncExternalStore<ValidationState>(
    validation ? validation.subscribe : subscribeToNothing,
    validation ? validation.getSnapshot : readUnchecked,
    readUnchecked,
  )

  const manifests = state.status === 'ready' ? state.manifests : NONE
  const components = useMemo(
    () => manifests.filter((entry): entry is Manifest => kindOf(entry) === 'component'),
    [manifests],
  )
  const groups = useMemo(() => groupsOf(components, query), [components, query])

  /*
   * The Blocks this document declares — absent until it projects, because a
   * Block is read off the typed projection and a half-written file has none.
   *
   * `null` and not an empty array: "no document to read" and "a document that
   * declares no Blocks" are different screens, and only the second is offered a
   * way to declare the first one.
   */
  const definition = document.status === 'ready' ? (document.workflow.definition ?? null) : null
  const blocks = useMemo(
    () => (definition ? filtered(definition.blocks ?? [], query) : null),
    [definition, query],
  )
  // Absent, not empty. Every Step is an unknown component until the manifests
  // land, so painting `byBlock` before `ready` marks every Block on every load.
  const problems = checks.ready ? checks.byBlock : NO_PROBLEMS

  const matched = groups.reduce((n, group) => n + group.manifests.length, 0) + (blocks?.length ?? 0)

  /**
   * Declare a Block, and say which one.
   *
   * The id is minted here rather than left to `addBlock` because the tab that
   * opens next has to be named (ADR-0017), and a command reports nothing back.
   * Read at click time, not at render time: the document may have moved since
   * this last drew, and an id minted against a stale one is the duplicate
   * `addBlock` refuses.
   */
  const declare = () => {
    const held = editing?.getSnapshot()
    if (!editing || held?.status !== 'ready') return
    const id = nextBlockId(held.workflow.document)
    editing.apply(addBlock({ id }))
    onBoardOpen?.(id)
  }

  /**
   * Remove a Block, once the user has been told what it costs.
   *
   * Deleting one that nothing calls and that holds no Steps takes nothing away
   * that is not on the card, so it goes straight through — a dialog in front of
   * it is friction with nothing to report. Everything else is confirmed,
   * because both costs are invisible from here: the Steps on its Board are on
   * another screen, and its call sites are wherever somebody wrote them.
   */
  const remove = (block: Block) => {
    if (!editing || !definition) return
    const cost = costOf(definition, block)
    if (cost.steps === 0 && cost.calls === 0) editing.apply(removeBlock(block.id))
    else setConfirming(cost)
  }

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

  /** Everything the panel would list with the filter box empty. */
  const listed = components.length + (definition?.blocks?.length ?? 0)

  const liveMessage =
    state.status === 'loading'
      ? 'Loading components…'
      : listed > 0 && matched === 0 && searching
        ? `Nothing matches “${query}”.`
        : ''

  return (
    <>
      <style href="hatua-components" precedence="hatua">
        {css}
      </style>
      <section aria-label="Components" className={cx(styles.components, className)} {...rest}>
        {/* Only once there is something to filter. A search box over a failed
            load offers to narrow nothing — and a document's Blocks are as much
            of the list as a Host's Components, so either is enough. */}
        {listed > 0 ? (
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
          {/*
            The other half of the `+` on the canvas. Clicking one names a place
            and brings the panel forward; without this, a panel already in front
            answers a click by changing nothing at all, and the next card picked
            lands somewhere the user has no reason to expect.
          */}
          {pending ? (
            <p className={styles.pending}>Pick a component to drop into the flow.</p>
          ) : null}

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

          {/*
            This document's own Components, above the Host's. A Block declared
            here is called as `block.<id>`, which is the third root of the verb
            namespace and the only one the user writes themselves.
          */}
          {blocks ? (
            <div className={styles.group}>
              <h2 className={styles.groupHeading}>Blocks</h2>

              {blocks.length === 0 ? (
                <p className={styles.empty}>{searching ? 'No blocks match.' : 'No blocks yet.'}</p>
              ) : (
                <ul className={styles.cards}>
                  {blocks.map((block) => (
                    <BlockRow
                      key={block.id}
                      block={block}
                      problems={problems.get(block.id)}
                      onSelect={onSelect}
                      onOpen={onBoardOpen && (() => onBoardOpen(block.id))}
                      onRemove={() => remove(block)}
                    />
                  ))}
                </ul>
              )}

              {/* Not while filtering. A list narrowed to nothing still offers
                  this, and a Block declared out of a search reads as the thing
                  that was searched for. */}
              {searching ? null : (
                <div className={styles.action}>
                  <Button size="sm" onClick={declare}>
                    New block
                  </Button>
                </div>
              )}
            </div>
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

      {/*
        What deleting a Block costs, said before it happens rather than found
        afterwards. Its call sites are left naming a Block that is not there —
        the rule `removeBlock` follows — so the dialog is where the user is told
        that, not a repair mechanism standing in for it.
      */}
      <ConfirmDialog
        open={confirming !== null}
        tone="danger"
        title={confirming ? `Delete “${confirming.name}”?` : ''}
        description={confirming ? costLine(confirming) : undefined}
        confirmLabel="Delete"
        onConfirm={() => {
          if (confirming) editing?.apply(removeBlock(confirming.id))
          setConfirming(null)
        }}
        onCancel={() => setConfirming(null)}
      />
    </>
  )
}

/**
 * One Host Component.
 *
 * A card with no name still draws, because dropping it would leave a Host
 * debugging a catalogue by counting rows that are not there. What it cannot do
 * without a verb is become a Step, so that — and not the name — is what decides
 * whether it is a control at all.
 */
function Card({
  manifest,
  onSelect,
}: {
  manifest: Manifest
  onSelect?: (component: ComponentDrag) => void
}) {
  const use = textOf(manifest.use)
  // The Host's name and not the fallback below: this is written into the
  // document as the Step's own name, and "Unnamed component" is a sentence
  // about a broken manifest rather than something to call a Step.
  const declared = textOf(manifest.name)
  const name = declared ?? use ?? 'Unnamed component'

  return (
    <CatalogueCard
      icon={<IconCoin manifest={manifest} />}
      name={name}
      blurb={textOf(manifest.blurb)}
      // An entry the Host malformed badly enough to have no verb is a row to
      // read, never a control: there is nothing to write a Step with, so a
      // button here would take a tab stop and answer a click by doing nothing.
      drag={use ? { use, ...(declared ? { name: declared } : {}) } : undefined}
      onSelect={onSelect}
    />
  )
}

/**
 * One Block this document declares, and the bin that takes it away.
 *
 * The bin is beside the card rather than inside it: a button cannot contain a
 * button, and they are two commands — the same reason the canvas's tab strip
 * puts its close control beside the label rather than in it.
 */
function BlockRow({
  block,
  problems,
  onSelect,
  onOpen,
  onRemove,
}: {
  block: Block
  problems?: Diagnostic[]
  onSelect?: (component: ComponentDrag) => void
  /** Absent when the caller holds no Board, which is when there is nowhere to go. */
  onOpen?: () => void
  onRemove: () => void
}) {
  const name = block.name || block.id

  return (
    <li className={styles.row}>
      <CatalogueCard
        // No manifest, because nothing declares a Block but the document it is
        // in. The neutral square is what the canvas already draws on a call for
        // the same reason, so the card and the node it becomes agree.
        icon={<IconCoin />}
        name={name}
        blurb={contractSummary(block)}
        drag={{ use: `${BLOCK_PREFIX}${block.id}`, name }}
        onSelect={onSelect}
      />
      {/*
        The doorway, in the word the canvas already uses on a call site and with
        the accessible name that card gives it. Set in type rather than drawn: a
        one-word control needs no glyph invented for it, and every mark near
        this one already means something else — the catalogue's own Return card
        is an arrow leaving a bracket, and a chevron is how a row unfolds.

        A control of its own and not the card. The card adds a call; this goes
        to the Board — two commands, and a button cannot contain a button.
      */}
      {onOpen ? (
        <button type="button" className={styles.open} aria-label={`Open ${name}`} onClick={onOpen}>
          Open
        </button>
      ) : null}
      <RemoveButton label={`Delete ${name}`} onClick={onRemove} />

      {/*
        Recursion, a duplicate id, a Board that promises an output and has a
        path off the end. Marked and never withheld: a Block in a cycle is still
        a Block the user is working on, and the checker names the problem where
        a greyed-out card would only say the panel had changed its mind.

        `role="status"` rather than `alert`: the same line ADR-0009 draws — this
        blocks Publish, never editing.
      */}
      {problems?.length ? (
        <p className={styles.problems} role="status">
          {problems.map((problem) => problem.message).join(' ')}
        </p>
      ) : null}
    </li>
  )
}

/**
 * The card both roots of the verb namespace are drawn as.
 *
 * A card is a button only when something happens on click. A control that does
 * nothing still takes a tab stop, still says "button" to a screen reader and
 * still invites a click — so the Host that mounts <Components /> to browse a
 * catalogue gets a list, and the one that passes onSelect gets controls.
 *
 * Draggable whenever it is actionable, because the canvas's `+` is a drop
 * target and this is the other half of that gesture. The click path stays:
 * HTML5 drag and drop is unreachable from the keyboard, so a catalogue whose
 * only route into the tree is a drag is a catalogue some people cannot use.
 *
 * Both gestures carry one payload — the verb and what to call it — so a card
 * dropped and the same card clicked cannot write two different Steps.
 */
function CatalogueCard({
  icon,
  name,
  blurb,
  drag,
  onSelect,
}: {
  icon: ReactNode
  name: string
  blurb?: string
  /** What a Step made from this card is written with, or undefined when there is nothing to write. */
  drag?: ComponentDrag
  onSelect?: (component: ComponentDrag) => void
}) {
  const body = (
    <>
      {icon}
      <span className={styles.text}>
        <span className={styles.name}>{name}</span>
        {blurb ? <span className={styles.blurb}>{blurb}</span> : null}
      </span>
    </>
  )

  return onSelect && drag ? (
    <button
      type="button"
      className={cx(styles.card, styles.actionable)}
      draggable
      onClick={() => onSelect(drag)}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'copy'
        event.dataTransfer.setData(COMPONENT_MIME, encodeComponent(drag))
        // `text/plain` for everyone else on the page: a drop into any other
        // editor still pastes the verb, which is the one thing that identifies
        // what was dragged.
        event.dataTransfer.setData('text/plain', drag.use)
        // The same chip a Step dragged across the canvas carries, so the two
        // gestures look alike and neither covers the gap it is aimed at.
        setDragChip(event.dataTransfer, event.currentTarget, name || drag.use)
      }}
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

/** The same distinction for the document, which this region reads and never reports. */
type DocumentState = EditingState | { status: 'unconfigured' }

const UNCONFIGURED = { status: 'unconfigured' } as const
const LOADING = { status: 'loading' } as const
const OPENING = { status: 'opening' } as const
const NONE: ManifestEntry[] = []
const NO_PROBLEMS: ReadonlyMap<string, Diagnostic[]> = new Map()
const UNCHECKED: ValidationState = {
  byStep: NO_PROBLEMS,
  byTrigger: NO_PROBLEMS,
  byBlock: NO_PROBLEMS,
  all: [],
  ready: false,
}

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
const readUnopened = (): DocumentState => UNCONFIGURED
const readOpening = (): DocumentState => OPENING
const readUnchecked = (): ValidationState => UNCHECKED

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

/** A Block matches what a Component would: what it is called, and what calls it. */
const filtered = (blocks: readonly Block[], query: string): readonly Block[] => {
  const needle = query.trim().toLowerCase()
  if (!needle) return blocks
  return blocks.filter((block) =>
    [block.name, block.id].some((field) => textOf(field)?.toLowerCase().includes(needle)),
  )
}

/** What deleting one Block takes with it. */
interface Cost {
  id: string
  /** What to call it on the dialog — its name, or the id standing in for one. */
  name: string
  /** Steps on its Board, at every depth: a call inside a Fork branch goes too. */
  steps: number
  /** Steps that call it, anywhere in the document. */
  calls: number
}

const costOf = (definition: WorkflowDefinition, block: Block): Cost => ({
  id: block.id,
  name: block.name || block.id,
  steps: [...walkSteps(block.steps)].length,
  calls: callSitesOf(definition, block.id).length,
})

/**
 * What the confirmation says, in the order the user is about to lose it.
 *
 * The call sites come last because they are the half that outlives the Block:
 * the Steps on its Board go with it, and the calls stay behind naming something
 * that is not there. Each half is said only when it is true — a sentence about
 * "0 steps" is a fact the dialog invented to have three sentences.
 */
function costLine({ steps, calls }: Cost): string {
  const parts: string[] = []
  if (steps > 0) parts.push(`It has ${steps} ${steps === 1 ? 'step' : 'steps'} on it.`)
  if (calls > 0) {
    parts.push(
      calls === 1
        ? 'One step calls it, and will be left calling a block that is not here.'
        : `${calls} steps call it, and will be left calling a block that is not here.`,
    )
  }
  return parts.join(' ')
}
