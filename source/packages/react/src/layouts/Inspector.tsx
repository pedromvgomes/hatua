import { referencePath, referencesIn, tryParseTemplate } from '@hatua/expressions'
import {
  type BoardId,
  blockIdOf,
  blockOf,
  boardOf,
  type Diagnostic,
  nameOf,
  RETURN_VERB,
  type ScopeEntry,
  type Segment,
  scopeFor,
  slotsForStep,
  stepKey,
} from '@hatua/model'
import {
  type Connection,
  contextKeysIn,
  type Declaration,
  type ManifestEntry,
  manifestsIn,
} from '@hatua/schema'
import {
  declareConnection,
  type EditingState,
  type ManifestState,
  sequence,
  setStepField,
  setStepName,
  stepIn,
  type ValidationState,
} from '@hatua/services'
import { type ComponentPropsWithRef, useEffect, useId, useMemo, useSyncExternalStore } from 'react'
import { TemplateInput } from '../compounds/TemplateInput'
import { Button } from '../primitives/Button'
import { cx } from '../primitives/classNames'
import { useEditingStore, useManifestStore, useValidationStore } from '../theme/HatuaProvider'
import { CommittedInput, Fields } from './Fields'
import styles from './Inspector.module.css'
import css from './Inspector.module.css?inline'

/**
 * The step editor: the selected Step's fields, each one a Slot holding a
 * Template typed by the Component Manifest.
 *
 * It is an `<aside>` rather than a `<section>` because it is about whatever is
 * selected elsewhere — which is also why a Host can mount it in a drawer of its
 * own and lose nothing.
 *
 * ## The form is `<Fields>`, and that is the whole of it
 *
 * A Trigger's fields and a Step's fields are the same shape declared by the
 * same schema, and differ only in which key of the document they are written
 * back to. So this region resolves *which* Step, hands the form its values and
 * its scope, and turns each edit into a command. It draws no field of its own,
 * and it does not special-case a Step's fields against a Trigger's.
 *
 * ## What a selection is
 *
 * A **Segment** — one Board and contiguous sibling Steps on it (ADR-0020) — and
 * never a bare id, because ids are Board-local and two Blocks may each hold a
 * Step called `ret`. A Segment of several is a legitimate selection and there
 * is nothing to edit for it: the fields belong to one Step, and a form drawn
 * over several would have to invent what a shared value means.
 *
 * Held by whatever composes the regions and handed down as a prop, exactly as
 * `<StepList>` and `<FlowMap>` take theirs. No selection context: a second
 * mechanism for one piece of chrome state is how the parts stop being
 * independently mountable.
 *
 * ## The Data panel beside it
 *
 * The editor expands leftward into `<Data>`, which is a sibling region rather
 * than something mounted from here — the composition root places it, the same
 * way it places everything else. What this owns is the control that asks for
 * it, and the `highlight` that comes back: a leaf pointed at over there marks
 * the fields reading it over here, which is what ties the two columns together.
 */
export interface InspectorProps extends ComponentPropsWithRef<'aside'> {
  /**
   * What is selected, as a Segment and never a bare id.
   *
   * `null` and `undefined` mean the same thing here — nothing is selected —
   * because this region holds no selection of its own to fall back to. It shows
   * what it is handed.
   */
  selected?: Segment | null
  /**
   * A Reference path the Data panel is pointing at, or `null`.
   *
   * Every field whose Template reads it is marked, which is the only thing on
   * screen relating a leaf in one column to the fields it fills in another.
   */
  highlight?: string | null
  /** Whether the Data panel beside this is open, and a way to ask for it. */
  expanded?: boolean
  onExpandedChange?: (expanded: boolean) => void
}

/** "The Host wired nothing" is not a phase of the load, so it is not the store's to report. */
type EditorState = EditingState | { status: 'unconfigured' }
type CatalogueState = ManifestState | { status: 'unconfigured' }

const UNCONFIGURED = { status: 'unconfigured' } as const
const OPENING = { status: 'opening' } as const
const CATALOGUE_UNCONFIGURED = { status: 'unconfigured' } as const
const CATALOGUE_LOADING = { status: 'loading' } as const
const NO_ENTRIES: ManifestEntry[] = []
const NO_SCOPE: readonly ScopeEntry[] = []
const NO_PROBLEMS: ReadonlyMap<string, Diagnostic[]> = new Map()
const NO_KEYS: ReadonlySet<string> = new Set()
const UNCHECKED: ValidationState = {
  byStep: NO_PROBLEMS,
  byTrigger: NO_PROBLEMS,
  byBlock: NO_PROBLEMS,
  all: [],
  ready: false,
}

// Module-level and therefore stable: useSyncExternalStore re-subscribes
// whenever `subscribe` changes identity, and re-renders forever if `getSnapshot`
// returns a fresh object each call.
const subscribeToNothing = () => () => {}
const readUnconfigured = (): EditorState => UNCONFIGURED
const readOpening = (): EditorState => OPENING
const readCatalogueUnconfigured = (): CatalogueState => CATALOGUE_UNCONFIGURED
const readCatalogueLoading = (): CatalogueState => CATALOGUE_LOADING
const readUnchecked = (): ValidationState => UNCHECKED

export function Inspector({
  className,
  selected,
  highlight = null,
  expanded = false,
  onExpandedChange,
  ...rest
}: InspectorProps) {
  const store = useEditingStore()
  const manifests = useManifestStore()
  const validation = useValidationStore()
  // Mounted twice on one page — a Host's drawer beside <Build>'s column — two
  // fixed ids would make the second label point at the first box.
  const nameId = useId()

  // The one side effect: tell each store somebody is reading. Both are
  // idempotent, so every region that mounts may call them and only the first
  // opens the Draft or fetches the catalogue.
  useEffect(() => {
    store?.open()
    manifests?.load()
  }, [store, manifests])

  const state = useSyncExternalStore<EditorState>(
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
    validation ? validation.getSnapshot : readUnchecked,
    readUnchecked,
  )

  const workflow = state.status === 'ready' ? state.workflow : null
  const definition = workflow?.definition ?? null
  const entries = catalogue.status === 'ready' ? catalogue.manifests : NO_ENTRIES
  const served = useMemo(() => manifestsIn(entries), [entries])
  const context = useMemo(() => contextKeysIn(entries), [entries])

  const board: BoardId = selected?.board ?? null
  // One Step, and only when exactly one is selected. `undefined` covers both
  // "nothing is selected" and "the Step is not on this Board any more", which
  // the render below tells apart from `selected` itself.
  const step = useMemo(() => {
    if (!definition || !selected || selected.steps.length !== 1) return undefined
    const only = selected.steps[0]
    const found = boardOf(definition, board)
    return only && found ? stepIn(found.steps, only) : undefined
  }, [definition, selected, board])

  const manifest = step ? served.find((entry) => entry.use === step.use) : undefined

  /**
   * The arguments a Step takes when something other than a Component Manifest
   * declares them.
   *
   * A **Board's root is its contract** (CONTEXT.md), so a call takes the Block's
   * parameters and a `core.return` supplies that Board's outputs — declared in
   * the document rather than by a manifest, which is why `manifest` is
   * `undefined` for both and why "nothing declares this step type" would be
   * false about either. `slotsForStep` already types them the same way for the
   * checker and for the panel beside this.
   */
  const contract = useMemo(() => {
    if (!definition || !step) return undefined
    const called = blockIdOf(step.use)
    if (called !== null) return blockOf(definition, called)?.params
    if (step.use === RETURN_VERB && board !== null) return blockOf(definition, board)?.outputs
    return undefined
  }, [definition, step, board])

  /**
   * What a Template in this form may read.
   *
   * `scopeFor` and not `boardScope`: a Step has a position in the tree, and
   * only the Steps that are guaranteed to have run by the time this one does
   * are readable from it. Offering a sibling branch's output would express a
   * mapping that cannot resolve at run time.
   */
  const scope = useMemo(
    () =>
      definition && step ? scopeFor(definition, { board, id: step.id }, served, context) : NO_SCOPE,
    [definition, step, board, served, context],
  )

  // Absent, not empty. "Not checked yet" and "checked and fine" must not look
  // the same: every Step is an unknown component until the manifests land, so
  // painting `byStep` before `ready` would mark a perfectly good Step on load.
  /*
   * Keyed by `stepKey`, never by the bare id. Ids are Board-local, so a
   * diagnostic about a Step inside a Block is filed under `<board>/<id>` — and
   * a bare-id lookup finds nothing for every Step on every Board but the root,
   * which is a card the canvas marks and this panel draws clean.
   */
  const problems =
    (checks.ready ? checks.byStep : NO_PROBLEMS).get(step ? stepKey({ board, id: step.id }) : '') ??
    []

  /**
   * Which fields read the path the Data panel is pointing at.
   *
   * Over the Slots rather than over the raw `with:` values, because a `map`
   * field holds one Template per entry and each is separately a reader — and
   * over the parsed AST rather than a search of the text, because
   * `{{ steps.s1.total }}` and `{{ steps.s1.totals }}` share a prefix and only
   * the grammar knows where a path ends.
   */
  const reading = useMemo(
    () =>
      definition && step && highlight
        ? fieldsReading(slotsForStep(definition, board, step, manifest), highlight)
        : NO_KEYS,
    [definition, step, board, manifest, highlight],
  )

  const ref = step ? { board, id: step.id } : null

  return (
    <>
      <style href="hatua-inspector" precedence="hatua">
        {css}
      </style>
      <aside aria-label="Inspector" className={cx(styles.inspector, className)} {...rest}>
        <div className={styles.head}>
          <p className={styles.title}>{step ? nameOf(step) : 'Nothing selected'}</p>
          {onExpandedChange ? (
            <Button
              size="sm"
              variant="ghost"
              aria-pressed={expanded}
              onClick={() => onExpandedChange(!expanded)}
            >
              {expanded ? 'Hide data' : 'Show data'}
            </Button>
          ) : null}
        </div>

        <div className={styles.body}>
          {state.status === 'unconfigured' ? (
            <p className={styles.note}>
              No workflow is wired up. Hatua has no storage of its own — a Host supplies it as{' '}
              <code className={styles.code}>{'ports={{ workflows }}'}</code>, and names which
              workflow to open as <code className={styles.code}>workflowId</code>, both on{' '}
              <code className={styles.code}>{'<HatuaProvider>'}</code>.
            </p>
          ) : null}

          {state.status === 'opening' ? (
            <p className={styles.note} role="status">
              Opening the workflow…
            </p>
          ) : null}

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
            forces this region to have. `toJSON()` throws here, so there is no
            Step to resolve; the document is still open and still editable, and
            Text Mode is where it gets fixed.
          */}
          {workflow && !definition ? (
            <p className={styles.note}>
              This document is not a valid Workflow Definition yet, so there is nothing to edit
              here. {workflow.invalid?.message} Your text is intact — nothing has been discarded.
            </p>
          ) : null}

          {definition && !selected ? (
            <p className={styles.note}>Select a step to fill it in.</p>
          ) : null}

          {/*
            Anything but exactly one, which is a Segment of several and also the
            empty one a Host may hand in. Settings belong to one Step either
            way, and a body with nothing in it and no sentence is the state a
            region must never be left in.
          */}
          {definition && selected && selected.steps.length !== 1 ? (
            <p className={styles.note}>
              {selected.steps.length > 1
                ? `${selected.steps.length} steps are selected. Settings belong to one step, so pick a single one to fill it in.`
                : 'Select a step to fill it in.'}
            </p>
          ) : null}

          {definition && selected && selected.steps.length === 1 && !step ? (
            <p className={styles.note}>That step is not in this workflow.</p>
          ) : null}

          {definition && step && ref ? (
            <>
              <div className={styles.identity}>
                <label className={styles.label} htmlFor={nameId}>
                  Name
                </label>
                <CommittedInput
                  id={nameId}
                  // The same word the visible <label> carries, so the
                  // accessible name and the text on screen agree: voice
                  // control acts on what a user can read, and "Name of Send
                  // mail" is not on the screen anywhere.
                  label="Name"
                  value={step.name ?? ''}
                  placeholder={manifest?.name ?? step.use}
                  onCommit={(next) => store?.apply(setStepName(ref, next))}
                />
                {/* The verb and the id, mono, because both are what a Template
                    writes: `{{ steps.s2.… }}` addresses this Step by the id
                    shown here. */}
                <p className={styles.meta}>
                  {step.use} · {step.id}
                </p>
              </div>

              {problems.length > 0 ? (
                /*
                  `role="status"` rather than `alert`: an unfilled field is the
                  normal state of a Step someone just added, and interrupting a
                  screen reader for it every time would make the builder
                  unusable. ADR-0009 draws the same line — this blocks Publish,
                  never editing.
                */
                <p className={styles.problems} role="status">
                  {problems.map((problem) => problem.message).join(' ')}
                </p>
              ) : null}

              {contract ? (
                <Contract
                  declarations={contract}
                  values={(step.with ?? {}) as Record<string, unknown>}
                  scope={scope}
                  highlighted={reading}
                  onChange={(key, next) => store?.apply(setStepField(ref, key, next))}
                />
              ) : manifest ? (
                <Fields
                  manifest={manifest}
                  values={(step.with ?? {}) as Record<string, unknown>}
                  connections={definition.connections ?? NO_CONNECTIONS}
                  scope={scope}
                  highlighted={reading}
                  onChange={(key, next) => store?.apply(setStepField(ref, key, next))}
                  onDeclareConnection={(key, id, handle) =>
                    // One undoable change: binding the handle and pointing the
                    // field at it are two edits and one thing the user did.
                    store?.apply(
                      sequence(
                        `Use ${id}`,
                        declareConnection(id, handle),
                        setStepField(ref, key, id),
                      ),
                    )
                  }
                />
              ) : (
                // Only when the checker has not already said something. It
                // names the verb, or the Block a call cannot find, better than
                // this can — and without a catalogue wired there is no checker
                // at all, which is when a Step would otherwise be a name box
                // with no account of why it has nothing else on it.
                problems.length === 0 && (
                  <p className={styles.note}>
                    Nothing declares this step type, so it has no settings.
                  </p>
                )
              )}
            </>
          ) : null}
        </div>
      </aside>
    </>
  )
}

const NO_CONNECTIONS: readonly Connection[] = []

/**
 * The arguments a Board's contract declares, as Templates.
 *
 * Not `<Fields>`, because a `Declaration` is not a `Field`: it carries the type
 * the argument must produce rather than a widget kind, and a call's argument is
 * always a Template — `{{ … }}` reading the call site's scope, whatever the
 * declared type is. A synthesised manifest would have to pick a field kind per
 * type, and `FIELD_KIND_TYPES` has no mappable kind that produces a boolean or
 * a datetime, so half of them would be checked against the wrong thing.
 *
 * Every declaration is drawn, filled in or not: one nobody has answered is
 * reported as missing by its own rule, and hiding the row leaves nothing on
 * screen to act on.
 */
function Contract({
  declarations,
  values,
  scope,
  highlighted,
  onChange,
}: {
  declarations: readonly Declaration[]
  values: Record<string, unknown>
  scope: readonly ScopeEntry[]
  highlighted: ReadonlySet<string>
  onChange: (key: string, value: string) => void
}) {
  return (
    <div className={styles.contract}>
      {declarations.map((declaration) => (
        <Argument
          key={declaration.k}
          declaration={declaration}
          value={values[declaration.k]}
          scope={scope}
          highlighted={highlighted.has(declaration.k)}
          onChange={(next) => onChange(declaration.k, next)}
        />
      ))}
    </div>
  )
}

function Argument({
  declaration,
  value,
  scope,
  highlighted,
  onChange,
}: {
  declaration: Declaration
  value: unknown
  scope: readonly ScopeEntry[]
  highlighted: boolean
  onChange: (next: string) => void
}) {
  const id = useId()
  return (
    <div className={styles.field} data-highlighted={highlighted ? 'true' : undefined}>
      <label className={styles.label} htmlFor={id}>
        {declaration.label}
      </label>
      <TemplateInput
        id={id}
        label={declaration.label}
        value={typeof value === 'string' ? value : ''}
        scope={scope}
        expectedType={declaration.t}
        onCommit={onChange}
      />
      {/* The declared type, because nothing else on the row says what the
          argument has to produce — the rail marks whether it does, and a mark
          with no statement of the target is a verdict without a question. */}
      <p className={styles.meta}>{declaration.t}</p>
    </div>
  )
}

/**
 * The field keys whose Template reads `path`.
 *
 * A Slot for a `map` entry is named `<field>.<key>`, and the row on screen is
 * the field — so the key is everything before the first dot. A Template that
 * does not parse reads nothing, which is the ordinary state of one halfway
 * through being typed.
 */
function fieldsReading(
  slots: readonly { name: string; template: string }[],
  path: string,
): ReadonlySet<string> {
  const keys = new Set<string>()
  for (const slot of slots) {
    const parsed = tryParseTemplate(slot.template)
    if (!parsed.ok) continue
    const reads = parsed.template.segments.some(
      (segment) =>
        segment.kind === 'Hole' &&
        referencesIn(segment.expr).some((node) => referencePath(node) === path),
    )
    if (reads) keys.add(slot.name.split('.')[0] ?? slot.name)
  }
  return keys
}
