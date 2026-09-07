import { type BoardId, blockOf, boardScope, type Diagnostic, type ScopeEntry } from '@hatua/model'
import {
  type Block,
  type Connection,
  contextKeysIn,
  type Declaration,
  type Manifest,
  type ManifestEntry,
  manifestsIn,
  type Trigger,
  type Variable,
} from '@hatua/schema'
import {
  addDeclaration,
  addTrigger,
  addVariable,
  type ContractSide,
  declareConnection,
  type EditingState,
  isUsableName,
  type ManifestState,
  removeDeclaration,
  removeTrigger,
  removeVariable,
  renameBlock,
  renameDeclaration,
  renameVariable,
  sequence,
  setBlockName,
  setDeclarationLabel,
  setDeclarationType,
  setTriggerField,
  setTriggerName,
  setVariableType,
  setVariableValue,
  setWorkflowName,
  setWorkflowSlug,
  unchecked,
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
import { TemplateInput } from '../compounds/TemplateInput'
import { Button } from '../primitives/Button'
import { cx } from '../primitives/classNames'
import { Select } from '../primitives/Select'
import { useEditingStore, useManifestStore, useValidationStore } from '../theme/HatuaProvider'
import { RemoveButton } from '../units/RemoveButton'
import { CommittedInput, Fields, splitByField } from './Fields'
import styles from './Workflow.module.css'
import css from './Workflow.module.css?inline'

/**
 * The Workflow tab: everything scoped to a **Board** rather than to a Step.
 *
 * Three sections — the name and slug, the Board's root, the variables — and one
 * thing they have in common: none of them is addressed by a position in the
 * Step tree. That is what makes them one region rather than three, and it is
 * why the Flow tab beside it holds none of them.
 *
 * ## A Board's root is its contract, so the middle section changes
 *
 * At the root Board that section is the **Triggers**; on a Block's Board it is
 * that Block's **Contract** — its parameters and its outputs. They are the same
 * slot said twice (CONTEXT.md), which the canvas has drawn as one `<RootNode>`
 * all along: `Triggers` / `1 trigger` at the root, the Block's name and
 * `2 params · 1 output` inside one. This is that slot's editor.
 *
 * Identity and the variables are the same section on both, addressing whichever
 * Board is on screen: `setBlockName` rather than `setWorkflowName`, and a
 * Block's own `vars:` rather than the workflow's. Every variable command has
 * taken a Board since it was written, because a `core.set_var` can never reach
 * out of the Board it is on.
 *
 * ## The Triggers section is the surface, not the form
 *
 * A Trigger's fields are drawn by `<Fields>`, which is the same component the
 * step editor mounts: the fields are declared by the same schema and differ
 * only in which key of the document they are written back to. So editing a
 * Trigger and editing a Step are one form, and where that form appears is a
 * rendering decision — which is what lets the canvas's start node open it later
 * without `triggers[]` moving into `steps[]`.
 *
 * It is here rather than in the step editor because the step editor and the
 * canvas are both still stubs, so there is nowhere else to select a Trigger
 * from. The same reasoning keeps the Flow tab in `<Build>`'s default set.
 *
 * ## What it does not hold
 *
 * The version and the status. ADR-0011 settled it: a property of the whole
 * document, shown behind a tab, is visible only while that tab is open, and the
 * canvas, the step editor and the run history would all still be showing v5
 * with nothing on screen saying so. That argument is generic to any tab,
 * including this one. The top bar DISPLAYS identity and version; this tab EDITS
 * the name and slug. One surface each.
 *
 * ## Two stores, and either may be absent
 *
 * The first region other than validation to need both. The document supplies
 * the Triggers a workflow declares; the catalogue supplies what a Trigger's
 * fields *are*, and which types can be added. A Host that wired a
 * `WorkflowStore` and no `ManifestSource` is a real case — every field on
 * `HostPorts` is optional — so the Triggers section degrades to its own empty
 * state rather than throwing, and "the Host wired nothing" stays distinct from
 * "the Host declared nothing".
 *
 * ## Which Board, and where the document comes from
 *
 * The Board arrives as a prop, the way `<StepList>` takes one: which Board is
 * on screen is chrome, held by whatever composes the screen, and the canvas is
 * the only surface with a doorway in it. Absent means the root, so a Host that
 * never opens a Block mounts this exactly as it always did.
 *
 * The document does not arrive that way. Both embeddings mount this region
 * bare — `apps/playground/src/host.tsx` writes `<Workflow />` and
 * `layouts/regions.test.tsx` renders it with nothing above it — so a document
 * prop would break the promise those two exist to keep. Every edit goes through
 * the editing store as a command, which is what makes an edit here and a text
 * edit the same edit.
 */
export interface WorkflowProps extends ComponentPropsWithRef<'section'> {
  /** Whose Identity, root and variables are shown. `null` is the root Board. */
  board?: BoardId
  /**
   * Fired when a Block's slug is committed: the Board on screen is now called
   * `to`, and a caller holding the old id is holding one nothing resolves.
   */
  onBoardRename?: (from: string, to: string) => void
}

/**
 * What this region is called while it is showing `board`.
 *
 * The label names the KIND of thing, never which one. The canvas's tab strip
 * already says which Block is open, and repeating it here spends the panel's
 * width twice and breaks a two-tab strip on a long name.
 *
 * Exported because `views/Build` puts the same string on the tab above this
 * region, and a landmark and its tab label that disagree are one region with
 * two names.
 */
export const boardTabLabel = (board: BoardId): string => (board === null ? 'Workflow' : 'Block')

/** "The Host wired nothing" is not a phase of the load, so it is not the store's to report. */
type PanelState = EditingState | { status: 'unconfigured' }

const UNCONFIGURED = { status: 'unconfigured' } as const
const OPENING = { status: 'opening' } as const
const CATALOGUE_UNCONFIGURED = { status: 'unconfigured' } as const
const CATALOGUE_LOADING = { status: 'loading' } as const
const NO_ENTRIES: ManifestEntry[] = []
const NO_SCOPE: readonly ScopeEntry[] = []
const NO_PROBLEMS: ReadonlyMap<string, Diagnostic[]> = new Map()
// Module-level and therefore stable: useSyncExternalStore re-subscribes
// whenever `subscribe` changes identity, and re-renders forever if `getSnapshot`
// returns a fresh object each call.
const subscribeToNothing = () => () => {}
const readUnconfigured = (): PanelState => UNCONFIGURED
const readOpening = (): PanelState => OPENING
const readCatalogueUnconfigured = (): CatalogueState => CATALOGUE_UNCONFIGURED
const readCatalogueLoading = (): CatalogueState => CATALOGUE_LOADING

type CatalogueState = ManifestState | { status: 'unconfigured' }

export function Workflow({ className, board = null, onBoardRename, ...rest }: WorkflowProps) {
  const store = useEditingStore()
  const manifests = useManifestStore()
  const validation = useValidationStore()

  // The one side effect: tell each store somebody is reading. Both are
  // idempotent, so every region that mounts may call them and only the first
  // opens the Draft or fetches the catalogue.
  useEffect(() => {
    store?.open()
    manifests?.load()
  }, [store, manifests])

  const state = useSyncExternalStore<PanelState>(
    store ? store.subscribe : subscribeToNothing,
    store ? store.getSnapshot : readUnconfigured,
    // Without a server snapshot this throws during SSR, and the whole package
    // is built to render there (ADR-0003). Opening is the honest answer:
    // claiming the edit is a client concern, so that is what hydration matches.
    store ? readOpening : readUnconfigured,
  )

  const catalogue = useSyncExternalStore<CatalogueState>(
    manifests ? manifests.subscribe : subscribeToNothing,
    manifests ? manifests.getSnapshot : readCatalogueUnconfigured,
    manifests ? readCatalogueLoading : readCatalogueUnconfigured,
  )

  const checks = useSyncExternalStore<ValidationState>(
    validation ? validation.subscribe : subscribeToNothing,
    validation ? validation.getSnapshot : unchecked,
    unchecked,
  )

  const workflow = state.status === 'ready' ? state.workflow : null
  const definition = workflow?.definition ?? null
  /*
   * The Block this Board belongs to, or `null` at the root — and `null` again
   * when `board` names one the document does not declare, which is what a Block
   * removed in Text Mode leaves behind. Told apart below, because "the root
   * Board" and "a Board that is not there" are different screens.
   */
  const block = definition && board !== null ? (blockOf(definition, board) ?? null) : null
  const missingBlock = board !== null && !block
  const blocks = definition?.blocks ?? []
  // Split by kind, because the array a Host serves holds three. The Triggers
  // section wants the Component Manifests; scope wants the Run Context keys.
  const entries = catalogue.status === 'ready' ? catalogue.manifests : NO_ENTRIES
  const served = useMemo(() => manifestsIn(entries), [entries])
  const context = useMemo(() => contextKeysIn(entries), [entries])
  // Absent, not empty. "Not checked yet" and "checked and fine" must not look
  // the same: every Trigger is an unknown component until the manifests land,
  // so painting `byTrigger` before `ready` would mark a perfectly good workflow
  // on every load.
  const problems = checks.ready ? checks.byTrigger : NO_PROBLEMS

  /**
   * What a Template on this tab may read: Run Context, the Triggers and the
   * variables, and never a Step's output.
   *
   * `boardScope` and not `scopeFor`, because nothing here has a position in
   * the tree. A variable's value is not reached by running anything, so no Step
   * is guaranteed to have run by the time it is evaluated — offering one would
   * express a mapping that cannot resolve.
   */
  const scope = useMemo(
    () => (definition ? boardScope(definition, board, served, context) : NO_SCOPE),
    [definition, board, served, context],
  )

  const liveMessage =
    state.status === 'opening'
      ? 'Opening the workflow…'
      : workflow?.save.state === 'halted'
        ? 'Saving stopped. Your changes are still here.'
        : ''

  return (
    <>
      <style href="hatua-workflow" precedence="hatua">
        {css}
      </style>
      <section
        aria-label={boardTabLabel(board)}
        className={cx(styles.workflow, className)}
        {...rest}
      >
        <div className={styles.body}>
          {state.status === 'unconfigured' ? (
            <p className={styles.note}>
              No workflow is wired up. Hatua has no storage of its own — a Host supplies it as{' '}
              <code className={styles.code}>{'ports={{ workflows }}'}</code>, and names which
              workflow to open as <code className={styles.code}>workflowId</code>, both on{' '}
              <code className={styles.code}>{'<HatuaProvider>'}</code>.
            </p>
          ) : null}

          {/* One live region, mounted for the life of the panel. Rendered
              conditionally it announces nothing much of the time: a live region
              generally has to EXIST before its content changes for the change
              to be announced. */}
          <p className={cx(styles.note, !liveMessage && styles.silent)} role="status">
            {liveMessage}
          </p>

          {state.status === 'failed' ? (
            <div className={styles.failure} role="alert">
              <p className={styles.failureText}>
                The workflow could not be opened. {state.error.message}
              </p>
              <Button size="sm" onClick={() => store?.reopen()}>
                Try again
              </Button>
            </div>
          ) : null}

          {/*
            Parsed, held, and not a Workflow Definition — the state ADR-0001
            forces this region to have. `toJSON()` throws here, so there are no
            fields to draw; the document is still open and still editable, and
            Text Mode is where it gets fixed.
          */}
          {workflow && !definition ? (
            <p className={styles.note}>
              This document is not a valid Workflow Definition yet, so there is nothing to edit
              here. {workflow.invalid?.message} Your text is intact — nothing has been discarded.
            </p>
          ) : null}

          {definition && missingBlock ? (
            <p className={styles.note}>That block is not in this workflow.</p>
          ) : null}

          {definition && !missingBlock ? (
            <>
              {block ? (
                <Identity
                  name={block.name ?? ''}
                  namePlaceholder={block.id}
                  slug={block.id}
                  // A slug the command would refuse — a duplicate, or a name
                  // the schema cannot hold — is refused here too, because
                  // `EditingStore.apply` turns the command's throw into a
                  // no-op and the field would otherwise appear to drop
                  // characters at random.
                  refuseSlugName={refuseName(
                    blocks.filter((other) => other.id !== block.id).map((other) => other.id),
                    'Another block already uses this slug.',
                  )}
                  onName={(next) => store?.apply(setBlockName(block.id, next))}
                  onSlug={(next) => {
                    store?.apply(renameBlock(block.id, next))
                    // Reported rather than assumed: a caller holding the old id
                    // is holding one nothing resolves, and the canvas reads that
                    // as a deleted Block and drops back to the root.
                    onBoardRename?.(block.id, next)
                  }}
                />
              ) : (
                <Identity
                  name={definition.name}
                  slug={definition.id}
                  refuseSlugName={refuseSlug}
                  onName={(next) => store?.apply(setWorkflowName(next))}
                  onSlug={(next) => store?.apply(setWorkflowSlug(next))}
                />
              )}

              {block ? (
                <Contract
                  block={block}
                  onAdd={(side, declaration) =>
                    store?.apply(addDeclaration(block.id, side, declaration))
                  }
                  onRemove={(side, k) => store?.apply(removeDeclaration(block.id, side, k))}
                  onRename={(side, from, to) =>
                    store?.apply(renameDeclaration(block.id, side, from, to))
                  }
                  onLabel={(side, k, label) =>
                    store?.apply(setDeclarationLabel(block.id, side, k, label))
                  }
                  onType={(side, k, t) => store?.apply(setDeclarationType(block.id, side, k, t))}
                />
              ) : (
                <Triggers
                  triggers={definition.triggers ?? []}
                  catalogue={catalogue}
                  manifests={served}
                  problems={problems}
                  onAdd={(manifest) =>
                    store?.apply(addTrigger({ use: manifest.use, name: manifest.name }))
                  }
                  onRemove={(id) => store?.apply(removeTrigger(id))}
                  connections={definition.connections ?? []}
                  scope={scope}
                  onName={(id, name) => store?.apply(setTriggerName(id, name))}
                  onField={(id, key, value) => store?.apply(setTriggerField(id, key, value))}
                  onDeclareConnection={(triggerId, key, name, ref) =>
                    // One undoable change: binding the handle and pointing the
                    // field at it are two edits and one thing the user did.
                    store?.apply(
                      sequence(
                        `Use ${name}`,
                        declareConnection(name, ref),
                        setTriggerField(triggerId, key, name),
                      ),
                    )
                  }
                />
              )}

              <Variables
                variables={(block ? block.vars : definition.vars) ?? []}
                blurb={
                  block
                    ? 'Values this block keeps while it runs, read anywhere on it as '
                    : 'Values this workflow keeps, read anywhere as '
                }
                scope={scope}
                onAdd={() => store?.apply(addVariable(undefined, board))}
                onRemove={(key) => store?.apply(removeVariable(key, board))}
                onRename={(from, to) => store?.apply(renameVariable(from, to, board))}
                onType={(key, t) => store?.apply(setVariableType(key, t, board))}
                onValue={(key, value) => store?.apply(setVariableValue(key, value, board))}
              />
            </>
          ) : null}
        </div>
      </section>
    </>
  )
}

function Section({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section className={styles.section} aria-label={heading}>
      <h2 className={styles.sectionHeading}>{heading}</h2>
      {children}
    </section>
  )
}

/**
 * One captioned control inside a row card.
 *
 * The caption is a `<span>` and **not** a `<label>`. Every control here already
 * carries an accessible name saying which row it belongs to — `Name of thread`,
 * `Type of digest_to` — and a real `<label>` would put four controls on one
 * panel all answering to "Name". So the caption is what a reader sees, the
 * `aria-label` is what a reader hears, and the first is a prefix of the second.
 *
 * Without it the rows are three boxes of identical shape: a key, a label and a
 * type read as one six-box run the moment a second row appears, and nothing on
 * screen says which box is which.
 */
function RowField({
  caption,
  aside,
  children,
}: {
  caption: string
  /** A control belonging to the row rather than to the box — the bin. */
  aside?: ReactNode
  children: ReactNode
}) {
  return (
    <div className={styles.field}>
      <div className={styles.fieldHead}>
        <span className={styles.label}>{caption}</span>
        {aside}
      </div>
      {children}
    </div>
  )
}

/**
 * One row of the panel — a Trigger, a parameter, an output, a variable — as a
 * card that folds.
 *
 * **Folded, the row is one line and not just its name.** A contract with six
 * parameters is a page of boxes expanded and six lines folded, and a line
 * carrying only the name spends the width without answering the question the
 * user came with: the summary is `Thread · thread · text`, which is the whole
 * declaration. The canvas already says a Board's root this way — `2 params · 1
 * output` — so it is the panel agreeing with the map rather than a new idea.
 *
 * **Open by default.** Folding is a user managing clutter; a tab that opens
 * folded hides the editor from somebody who came to edit, and a Block with one
 * parameter would hide its only field for nothing.
 *
 * The state is the card's own. Nothing outside this panel draws a declaration,
 * so there is no second surface to keep in step — which is the whole reason the
 * canvas's collapse is lifted into `views/Build` and this is not. It resets
 * when the row's key changes, because the key is the React key: that is a row
 * somebody has just renamed and is still working on.
 *
 * The chevron is a button of its own rather than the whole header. The summary
 * holds a key a user may want to select, and text inside a button cannot be
 * selected — and an icon button with an `aria-label` is what the bin beside it
 * already is.
 */
function RowCard({
  title,
  summary,
  caption,
  name,
  note,
  removeLabel,
  onRemove,
  children,
}: {
  /** Which row this is, for the fold and remove controls to name. */
  title: string
  /** The whole row on one line, for when it is folded. */
  summary: ReactNode
  /** The first field's caption, which the header carries while open. */
  caption: string
  /** The first field's control. */
  name: ReactNode
  /**
   * What is wrong with this row, if anything.
   *
   * Outside the fold and not inside it: a folded row that hid its own
   * diagnostic would let somebody tidy a problem off their screen, and the
   * fold is for managing height rather than for silencing the checker.
   *
   * Given the fold's state, because a row whose body is on screen has somewhere
   * better to put a diagnostic that names a field — under the control it is
   * about — and a folded one has not. The invariant is what the row SAYS, not
   * where it says it.
   */
  note?: ReactNode | ((open: boolean) => ReactNode)
  removeLabel: string
  onRemove: () => void
  children?: ReactNode
}) {
  const [open, setOpen] = useState(true)
  const bodyId = useId()

  return (
    <li className={styles.card}>
      <div className={styles.cardHead}>
        <button
          type="button"
          className={styles.disclosure}
          aria-expanded={open}
          // Only while the body exists. Pointing at an id that is not rendered
          // gives a screen reader a region it cannot navigate to.
          aria-controls={open ? bodyId : undefined}
          aria-label={`Collapse ${title}`}
          onClick={() => setOpen((was) => !was)}
        >
          {/*
            Drawn rather than typed, for the reason the canvas's is: a Host
            chooses the face this renders in and the theme's own draws `▾` at
            four pixels wide. It turns to point at the row it is holding shut
            instead of swapping for a second character, so the two states are
            one shape at two angles.
          */}
          <svg
            className={cx(styles.chevron, !open && styles.shut)}
            viewBox="0 0 10 10"
            width="10"
            height="10"
            focusable="false"
            aria-hidden="true"
          >
            <path
              d="M2 4 5 7 8 4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        {open ? <span className={styles.label}>{caption}</span> : summary}
        {/* On the header's line rather than beside the box below, so the box
            keeps the whole width — a key, a Template and a friendly name each
            need it, and a bin in a second column takes 32px off every one. */}
        <RemoveButton label={removeLabel} onClick={onRemove} />
      </div>
      {typeof note === 'function' ? note(open) : note}
      {open ? (
        <div id={bodyId} className={styles.cardBody}>
          {name}
          {children}
        </div>
      ) : null}
    </li>
  )
}

/**
 * A folded row on one line: what it is called, then what it is.
 *
 * The name gives way before the rest does. A long name is the half a reader
 * recognises from its start and can hover or unfold to finish; a key truncated
 * to nothing is the row losing the thing that identifies it.
 */
function RowSummary({ name, meta, mono }: { name: string; meta: string; mono?: boolean }) {
  return (
    <p className={styles.summary}>
      {/* `title` because a 304px panel cannot always hold three facts on one
          line, and the name is the one that gives way: the key beside it is
          what every call site writes, so the row stays identifiable while the
          prose is a hover and an unfold away. */}
      <span className={cx(styles.summaryName, mono && styles.mono)} title={name}>
        {name}
      </span>
      <span className={styles.summaryMeta}>{meta}</span>
    </p>
  )
}

/**
 * Why a name cannot be used here, or `null` when it can.
 *
 * Two rules, one message at a time. The **shape** comes from `@hatua/schema`'s
 * `identifier` through `isUsableName`, so the field and the command answer the
 * same question from the same definition rather than agreeing by inspection —
 * and the field never has to spell the pattern, which is a thing no end user
 * can act on and the copy rule refuses outright.
 *
 * The **collision** is per kind, because "another parameter" and "another
 * variable" are different sentences about different lists.
 */
const refuseName =
  (taken: readonly string[], collision: string) =>
  (next: string): string | null => {
    if (!isUsableName(next))
      return 'Use letters, numbers and underscores, and don’t start with a number.'
    return taken.includes(next) ? collision : null
  }

/** A workflow's slug is a non-empty string and not an `identifier`; see `setWorkflowSlug`. */
const refuseSlug = (next: string): string | null =>
  next.trim() === '' ? 'A workflow needs a slug.' : null

/**
 * A name box that refuses a name the document cannot hold, and says so.
 *
 * Every command that writes a name throws on one it cannot use — a duplicate
 * key, or a name the schema's `identifier` refuses — and `EditingStore.apply`
 * turns a throw into a no-op. That is the right thing to do with a command
 * built against a tree that has moved on, and the wrong thing to do to a person
 * typing: the field appears to reject characters at random and says nothing
 * about why.
 *
 * So the box asks the same question the command will and declines to commit.
 * The name goes back to the one that is still true and the reason sits under
 * the field, which is the half that was missing: a box that reverts and says
 * nothing is indistinguishable from one that is broken.
 */
function NameInput({
  value,
  refuse,
  onCommit,
  className,
  ...rest
}: {
  value: string
  /** Why the typed name cannot be used, or null. */
  refuse: (next: string) => string | null
  onCommit: (next: string) => void
  label: string
  mono?: boolean
} & Omit<ComponentPropsWithRef<'input'>, 'value' | 'onChange' | 'onBlur'>) {
  const [clash, setClash] = useState<string | null>(null)
  const noteId = useId()

  return (
    // One element and not a fragment. Every row this sits in is a grid — a key
    // box beside a bin button — so a loose message would take the bin's column
    // and push it onto a line of its own.
    <div className={cx(styles.unique, className)}>
      <CommittedInput
        {...rest}
        // `aria-describedby` only while there is something to describe:
        // pointing at an element that is not rendered describes nothing and
        // gives a screen reader a dangling reference.
        aria-describedby={clash ? noteId : rest['aria-describedby']}
        aria-invalid={clash ? true : undefined}
        value={value}
        onCommit={(next) => {
          const why = refuse(next)
          if (why) {
            setClash(why)
            return
          }
          setClash(null)
          onCommit(next)
        }}
      />
      {clash ? (
        // `role="status"` rather than `alert`: this is a correction to
        // something the user is in the middle of, not an interruption, and the
        // same line ADR-0009 draws for a Trigger that is not filled in.
        <p className={styles.problems} id={noteId} role="status">
          {clash}
        </p>
      ) : null}
    </div>
  )
}

/**
 * The name and the slug — of the workflow at the root Board, of the Block
 * inside one.
 *
 * A 304px panel with two labelled fields is a better place to rename a workflow
 * than an inline-edited breadcrumb, and it keeps the top bar to display.
 *
 * **The slug goes stale without rewriting what names it.** Every `use:` calling
 * a renamed Block keeps the old slug and the checker reports it, which is the
 * rule `renameVariable` follows and for the same reason: mid-typing every
 * intermediate key is a rename too, so warning instead of rewriting would be a
 * dialog on every character.
 */
function Identity({
  name,
  namePlaceholder,
  slug,
  refuseSlugName,
  onName,
  onSlug,
}: {
  name: string
  namePlaceholder?: string
  slug: string
  /** Why a typed slug cannot be used here. The two Boards have different rules. */
  refuseSlugName: (next: string) => string | null
  onName: (next: string) => void
  onSlug: (next: string) => void
}) {
  const nameId = useId()
  const slugId = useId()

  return (
    <Section heading="Identity">
      <div className={styles.field}>
        <label className={styles.label} htmlFor={nameId}>
          Name
        </label>
        <CommittedInput
          id={nameId}
          label="Name"
          value={name}
          placeholder={namePlaceholder}
          onCommit={onName}
        />
      </div>
      <div className={styles.field}>
        <label className={styles.label} htmlFor={slugId}>
          Slug
        </label>
        <NameInput
          id={slugId}
          label="Slug"
          value={slug}
          mono
          refuse={refuseSlugName}
          onCommit={onSlug}
        />
      </div>
    </Section>
  )
}

/**
 * The workflow's Triggers.
 *
 * A Trigger is not a Step: `triggers` is a top-level list, `scopeFor` emits
 * `triggers.<id>` per entry plus a `TRIGGER` builtin once there are two, and
 * the canvas draws the start node from this list as chrome rather than as a
 * `steps[]` entry. That is what makes `core.start` unnecessary — `removeStep`
 * cannot find one, and `walkSteps` does not yield one.
 */
function Triggers({
  triggers,
  catalogue,
  manifests,
  problems,
  connections,
  scope,
  onAdd,
  onRemove,
  onName,
  onField,
  onDeclareConnection,
}: {
  triggers: readonly Trigger[]
  catalogue: CatalogueState
  manifests: readonly Manifest[]
  /** Diagnostics per Trigger id; a Trigger with none is absent. */
  problems: ReadonlyMap<string, Diagnostic[]>
  connections: readonly Connection[]
  scope: readonly ScopeEntry[]
  onAdd: (manifest: Manifest) => void
  onRemove: (id: string) => void
  onName: (id: string, name: string) => void
  onField: (id: string, key: string, value: string | number | boolean) => void
  onDeclareConnection: (triggerId: string, key: string, name: string, ref: string) => void
}) {
  const byUse = new Map(manifests.map((manifest) => [manifest.use, manifest]))
  const addable = manifests.filter((manifest) => manifest.kind === 'trigger')

  return (
    <Section heading="Triggers">
      <p className={styles.blurb}>What starts this workflow. Its outputs are the parameters.</p>

      {triggers.length === 0 ? (
        <p className={styles.empty}>Nothing starts this workflow yet.</p>
      ) : null}

      <ul className={styles.triggers}>
        {triggers.map((trigger) => (
          <TriggerCard
            key={trigger.id}
            trigger={trigger}
            manifest={byUse.get(trigger.use)}
            problems={problems.get(trigger.id)}
            connections={connections}
            scope={scope}
            onRemove={onRemove}
            onName={onName}
            onField={onField}
            onDeclareConnection={onDeclareConnection}
          />
        ))}
      </ul>

      <AddTrigger catalogue={catalogue} addable={addable} onAdd={onAdd} />
    </Section>
  )
}

/**
 * Adding one needs the catalogue, so this control has three states the list
 * above it does not: no catalogue was wired, one was and holds no Trigger, and
 * one that does. A Host supplying a `WorkflowStore` and no `ManifestSource`
 * lands in the first and still edits every Trigger the document declares.
 */
function AddTrigger({
  catalogue,
  addable,
  onAdd,
}: {
  catalogue: CatalogueState
  addable: readonly Manifest[]
  onAdd: (manifest: Manifest) => void
}) {
  const [use, setUse] = useState('')
  const pickerId = useId()

  if (catalogue.status === 'unconfigured') {
    return (
      <p className={styles.note}>
        No Component Manifests are wired up, so there are no Trigger types to choose from. A Host
        supplies them through{' '}
        <code className={styles.code}>{'<HatuaProvider ports={{ manifests }}>'}</code>.
      </p>
    )
  }

  if (catalogue.status === 'failed') {
    return (
      <p className={styles.empty} role="alert">
        The Trigger types could not be loaded. {catalogue.error.message}
      </p>
    )
  }

  if (catalogue.status === 'loading') return <p className={styles.empty}>Loading Trigger types…</p>

  if (addable.length === 0) {
    return <p className={styles.empty}>No Trigger types are available yet.</p>
  }

  const chosen = addable.find((manifest) => manifest.use === use) ?? addable[0]

  return (
    <div className={styles.add}>
      <label className={styles.offscreen} htmlFor={pickerId}>
        Trigger type
      </label>
      <Select
        id={pickerId}
        value={chosen?.use ?? ''}
        onChange={(event) => setUse(event.target.value)}
      >
        {addable.map((manifest) => (
          <option key={manifest.use} value={manifest.use}>
            {manifest.name}
          </option>
        ))}
      </Select>
      <Button className={styles.addAction} size="sm" onClick={() => chosen && onAdd(chosen)}>
        Add trigger
      </Button>
    </div>
  )
}

function TriggerCard({
  trigger,
  manifest,
  problems,
  connections,
  scope,
  onRemove,
  onName,
  onField,
  onDeclareConnection,
}: {
  trigger: Trigger
  manifest: Manifest | undefined
  problems?: Diagnostic[]
  connections: readonly Connection[]
  scope: readonly ScopeEntry[]
  onRemove: (id: string) => void
  onName: (id: string, name: string) => void
  onField: (id: string, key: string, value: string | number | boolean) => void
  onDeclareConnection: (triggerId: string, key: string, name: string, ref: string) => void
}) {
  const values = (trigger.with ?? {}) as Record<string, unknown>
  /*
   * A diagnostic that names a field is drawn under that field's control, and
   * only what is about the Trigger itself sits above the form. Collected, a run
   * of sentences all beginning "This expression expects…" names nothing a
   * reader can act on.
   */
  const { byField, aboutTheSubject: aboutTheTrigger } = splitByField(problems)

  return (
    <RowCard
      title={trigger.name || trigger.id}
      caption="Name"
      summary={
        /* The id and not the type: a Trigger named after its own Component —
           which is what adding one gives you — would otherwise fold to its name
           printed twice. The id is what `{{ triggers.overnight.… }}` writes, so
           it is a Trigger's key in the sense a declaration's `k` is. */
        <RowSummary name={trigger.name || trigger.id} meta={trigger.id} />
      }
      removeLabel={`Remove ${trigger.name || trigger.id}`}
      onRemove={() => onRemove(trigger.id)}
      name={
        <CommittedInput
          label={`Name of ${trigger.name || trigger.id}`}
          value={trigger.name ?? ''}
          placeholder={manifest?.name ?? trigger.use}
          onCommit={(next) => onName(trigger.id, next)}
        />
      }
      note={
        /*
          `role="status"` rather than `alert`: an unfilled field is the normal
          state of a Trigger someone just added, and interrupting a screen
          reader for it every time would make the builder unusable. ADR-0009
          draws the same line — this blocks Publish, never editing.
        */
        (open: boolean) => {
          /*
           * Open, the form below carries every diagnostic that names a field,
           * under the control it is about. Folded there is no form, so the row
           * says all of them here rather than letting the fold tidy a problem
           * off the screen.
           */
          const shown = open ? aboutTheTrigger : problems
          return shown?.length ? (
            <p className={styles.problems} role="status">
              {shown.map((problem) => problem.message).join(' ')}
            </p>
          ) : null
        }
      }
    >
      {/* The verb and the id, mono, because both are what a Template writes:
          `{{ triggers.t1.… }}` addresses this row by the id shown here. */}
      <p className={styles.meta}>
        {trigger.use} · {trigger.id}
      </p>

      {manifest ? (
        <Fields
          manifest={manifest}
          values={values}
          connections={connections}
          scope={scope}
          problems={byField}
          onChange={(key, next) => onField(trigger.id, key, next)}
          onDeclareConnection={(key, name, ref) => onDeclareConnection(trigger.id, key, name, ref)}
        />
      ) : (
        // Only when the checker has not already said it. Without a catalogue
        // wired there is no checker at all, and the card would otherwise be a
        // name box with no account of why it has nothing else on it.
        !aboutTheTrigger.some((problem) => problem.code === 'COMPONENT_UNKNOWN') && (
          <p className={styles.empty}>Nothing declares this trigger type, so it has no settings.</p>
        )
      )}
    </RowCard>
  )
}

/** What a new row is written with, and why it is written with anything at all. */
const SIDES = [
  {
    side: 'params' as ContractSide,
    heading: 'Parameters',
    empty: 'This block takes nothing.',
    add: 'Add parameter',
    clash: 'Another parameter already uses this name.',
    // Deterministic, so the same edits produce the same document twice, and
    // named rather than blank for the reason `addVariable` mints a key: the
    // schema requires `k`, `label` and `t`, so a row missing one is a document
    // that stops projecting the moment it appears.
    seed: 'parameter',
  },
  {
    side: 'outputs' as ContractSide,
    heading: 'Outputs',
    empty: 'This block publishes nothing.',
    add: 'Add output',
    clash: 'Another output already uses this name.',
    seed: 'output',
  },
] as const

/**
 * The friendly name a minted key deserves: `new_parameter_2` → `New parameter 2`.
 *
 * Derived rather than left equal to the key, because a row seeded with the key
 * in both boxes is two identical boxes holding identical text, and the caption
 * is then the only thing telling them apart. Derived rather than constant so
 * two new rows do not arrive under one name.
 */
function labelFor(key: string): string {
  const words = key.replace(/_/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** `new_parameter`, then `new_parameter_2` — the shape `addVariable` mints. */
function mintKey(seed: string, taken: readonly string[]): string {
  const first = `new_${seed}`
  if (!taken.includes(first)) return first
  for (let n = 2; ; n++) {
    const key = `new_${seed}_${n}`
    if (!taken.includes(key)) return key
  }
}

/**
 * A Block's contract: what it takes, and what it publishes.
 *
 * The section a Board's root gets, which at the root Board is the Triggers. It
 * is one section and not two because it is one idea — a Board's root IS its
 * contract (CONTEXT.md), and the canvas draws both halves in one `<RootNode>`
 * summary. Two sections here would put a divider through the middle of the
 * thing the panel is naming.
 *
 * **A row is appended, never inserted above.** A call site's fields are drawn in
 * declaration order, so a new parameter landing at the top would reorder a form
 * somebody is already looking at.
 *
 * **`of` has no control.** A `list` or an `object` may declare the shape of its
 * members, and nothing in the builder edits one yet — the row says what type it
 * is and Text Mode is where a shape is written.
 */
function Contract({
  block,
  onAdd,
  onRemove,
  onRename,
  onLabel,
  onType,
}: {
  block: Block
  onAdd: (side: ContractSide, declaration: Declaration) => void
  onRemove: (side: ContractSide, k: string) => void
  onRename: (side: ContractSide, from: string, to: string) => void
  onLabel: (side: ContractSide, k: string, label: string) => void
  onType: (side: ContractSide, k: string, t: string) => void
}) {
  return (
    <Section heading="Contract">
      <p className={styles.blurb}>
        What this block takes, read inside it as{' '}
        <code className={styles.code}>{'{{ params.name }}'}</code>, and what it publishes when it
        ends.
      </p>

      {SIDES.map(({ side, heading, empty, add, clash, seed }) => {
        const declared = (side === 'params' ? block.params : block.outputs) ?? []
        const keys = declared.map((declaration) => declaration.k)

        return (
          <div key={side} className={styles.group}>
            <h3 className={styles.groupHeading}>{heading}</h3>

            {declared.length === 0 ? <p className={styles.empty}>{empty}</p> : null}

            {declared.length > 0 ? (
              <ul className={styles.declarations}>
                {declared.map((declaration) => (
                  <DeclarationRow
                    key={declaration.k}
                    declaration={declaration}
                    taken={keys.filter((k) => k !== declaration.k)}
                    clash={clash}
                    onRemove={() => onRemove(side, declaration.k)}
                    onRename={(to) => onRename(side, declaration.k, to)}
                    onLabel={(label) => onLabel(side, declaration.k, label)}
                    onType={(t) => onType(side, declaration.k, t)}
                  />
                ))}
              </ul>
            ) : null}

            <Button
              size="sm"
              onClick={() => {
                const k = mintKey(seed, keys)
                onAdd(side, { k, label: labelFor(k), t: 'text' })
              }}
            >
              {add}
            </Button>
          </div>
        )
      })}
    </Section>
  )
}

/**
 * One parameter or one output: a friendly name, the key every Reference names,
 * and the declared type.
 *
 * **The name is first and the key is second**, which is the order a Trigger's
 * card already uses and the order they are read in: the name is what shows on
 * the call site's field and in the reference tree, and the key is what a
 * Template writes. Both are editable and neither explains the other, so both
 * are captioned — a name box above a key box with nothing saying which is which
 * is two identical boxes, and a new row seeded with the key in both is two
 * identical boxes holding identical text.
 */
function DeclarationRow({
  declaration,
  taken,
  clash,
  onRemove,
  onRename,
  onLabel,
  onType,
}: {
  declaration: Declaration
  taken: readonly string[]
  /** What to say when the typed key is one of `taken`. */
  clash: string
  onRemove: () => void
  onRename: (to: string) => void
  onLabel: (label: string) => void
  onType: (t: string) => void
}) {
  return (
    <RowCard
      title={declaration.k}
      caption="Name"
      summary={<RowSummary name={declaration.label} meta={`${declaration.k} · ${declaration.t}`} />}
      removeLabel={`Remove ${declaration.k}`}
      onRemove={onRemove}
      name={
        <CommittedInput
          label={`Name of ${declaration.k}`}
          value={declaration.label}
          onCommit={(next) => next && onLabel(next)}
        />
      }
    >
      <RowField caption="Key">
        <NameInput
          label={`Key of ${declaration.k}`}
          value={declaration.k}
          mono
          refuse={refuseName(taken, clash)}
          onCommit={(next) => next !== declaration.k && onRename(next)}
        />
      </RowField>

      <RowField caption="Type">
        <Select
          aria-label={`Type of ${declaration.k}`}
          className={styles.control}
          value={declaration.t}
          onChange={(event) => onType(event.target.value)}
        >
          {DECLARED_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </Select>
      </RowField>
    </RowCard>
  )
}

/**
 * The types a `t` may name, in the order the schema lists them.
 *
 * One list for a variable and a declaration because the schema spells their `t`
 * identically "so one function reads both" — the six values, and `item`
 * deliberately absent from either, because `item` resolves by following a loop's
 * `list` back to a source output and neither of these is the output of anything.
 */
const DECLARED_TYPES = ['text', 'number', 'boolean', 'datetime', 'object', 'list'] as const

/**
 * The workflow's variables: a key, a declared type and a Template, per row.
 *
 * **The type is declared, not read off the value.** `core.set_var` writes the
 * same variable from a Step, which is what makes the literal in the document its
 * FIRST value rather than its contract — a type read off it would be a claim
 * about one moment in an execution (ADR-0013). The type control is therefore the
 * one edit on this row that re-types every Expression reading the variable, and
 * the value box is not.
 *
 * The declared type reaches the screen through the value box's completion list
 * rather than through the box itself: it is what lets the picker rail the
 * candidate rows that fit, where a variable's value could rail none. Nothing is
 * ever marked wrong, so the field looks the same either way.
 *
 * **Renaming a key does not rewrite References.** `{{ var.old_name }}` goes
 * stale and the checker reports it, exactly as it does for a Step that was
 * removed. Rewriting every Template on a keystroke would edit the user's file
 * in places they are not looking, and mid-typing every intermediate key is a
 * rename too.
 */
function Variables({
  variables,
  blurb,
  scope,
  onAdd,
  onRemove,
  onRename,
  onType,
  onValue,
}: {
  variables: readonly Variable[]
  /** Whose values these are; the reference form is the same on every Board. */
  blurb: string
  scope: readonly ScopeEntry[]
  onAdd: () => void
  onRemove: (key: string) => void
  onRename: (from: string, to: string) => void
  onType: (key: string, t: string) => void
  onValue: (key: string, value: string) => void
}) {
  return (
    <Section heading="Variables">
      <p className={styles.blurb}>
        {blurb}
        <code className={styles.code}>{'{{ var.name }}'}</code>.
      </p>

      {variables.length === 0 ? <p className={styles.empty}>No variables yet.</p> : null}

      {variables.length > 0 ? (
        <ul className={styles.variables}>
          {variables.map((variable) => (
            /* A variable's key IS its name — it carries no friendly label,
               because `{{ var.digest_to }}` is what the builder shows and there
               is nothing else to call it. */
            <RowCard
              key={variable.key}
              title={variable.key}
              caption="Name"
              summary={<RowSummary name={variable.key} meta={variable.t} mono />}
              removeLabel={`Remove ${variable.key}`}
              onRemove={() => onRemove(variable.key)}
              name={
                <NameInput
                  label={`Name of ${variable.key}`}
                  value={variable.key}
                  mono
                  refuse={refuseName(
                    variables
                      .filter((other) => other.key !== variable.key)
                      .map((other) => other.key),
                    'Another variable already uses this name.',
                  )}
                  onCommit={(next) => next !== variable.key && onRename(variable.key, next)}
                />
              }
            >
              <RowField caption="Type">
                <Select
                  aria-label={`Type of ${variable.key}`}
                  className={styles.control}
                  value={variable.t}
                  onChange={(event) => onType(variable.key, event.target.value)}
                >
                  {DECLARED_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </Select>
              </RowField>

              <RowField caption="Value">
                <TemplateInput
                  label={`Value of ${variable.key}`}
                  value={
                    variable.value === undefined || variable.value === null
                      ? ''
                      : String(variable.value)
                  }
                  scope={scope}
                  // What the completion list judges a candidate against. It
                  // marks the rows that fit rather than the field itself —
                  // nothing here is ever marked wrong — so declaring the type is
                  // what lets the picker rail a row at all, where before it
                  // could rail none.
                  expectedType={variable.t}
                  onCommit={(next) => onValue(variable.key, next)}
                />
              </RowField>
            </RowCard>
          ))}
        </ul>
      ) : null}

      <Button size="sm" onClick={onAdd}>
        Add variable
      </Button>
    </Section>
  )
}
