import {
  descriptorsByUse,
  logFor,
  type MetadataDescriptor,
  nameOf,
  recordsFor,
  type Segment,
  type StepRecord,
  statusOf,
  totals,
} from '@hatua/model'
import {
  type Manifest,
  manifestsIn,
  type WorkflowDefinition,
  type WorkflowExecution,
} from '@hatua/schema'
import {
  type EditingState,
  type ExecutionsSnapshot,
  type ManifestState,
  stepIn,
} from '@hatua/services'
import { type ComponentPropsWithRef, useEffect, useMemo, useSyncExternalStore } from 'react'
import { cx } from '../primitives/classNames'
import { useEditingStore, useExecutionStore, useManifestStore } from '../theme/HatuaProvider'
import { Code } from '../units/Code'
import { valueTokens } from './highlight'
import styles from './RunStep.module.css'
import css from './RunStep.module.css?inline'
import { durationOf, momentOf, RUN_STATUS_LABEL, STATUS_LABEL } from './runRecords'

/**
 * The pane about the run, in the column `views/Build` gives the step editor.
 *
 * ## Two subjects, one pane
 *
 * With nothing selected it draws the **Workflow Execution** itself — what
 * happened, when, what fired it, and the totals derived from every Step's
 * metadata. With one Step selected it draws that Step's record, and the log
 * narrowed to the entries naming it. `logEntry.step` is what ties the two
 * together, and one pane is what makes it worth carrying.
 *
 * It is not the **Inspector** in another mode. That region is the step editor,
 * and this edits nothing: an execution is history, and Hatua never produces one
 * (CONTEXT.md).
 *
 * ## A Segment of several has no record
 *
 * A **Segment** is one or more contiguous Steps, and a run reports per Step —
 * so several selected is a question with several answers and no way to draw
 * them in one pane. It says so rather than picking the first, which would be a
 * pane quietly describing something other than what is highlighted.
 *
 * ## Totals are derived here and computed in the model
 *
 * `workflow-execution.schema.yaml` refuses a run-level metadata block outright,
 * because runners each inventing their own summary shape is a pane that can
 * render none of them generically. What it carries instead is per-Step values,
 * and the `measure` / `dimension` roles the **Component Manifests** declare are
 * what turn them into a total — which is `@hatua/model`'s `totals`, where a
 * Host's own viewer can reach it.
 */
export interface RunStepProps extends ComponentPropsWithRef<'section'> {
  /**
   * What is selected, as a Segment and never a bare id — the same prop
   * `<Inspector>` and `<Data>` take, because a selection is one thing across
   * every surface that reads it.
   */
  selected?: Segment | null
}

/**
 * What a region with no `ExecutionSource` reads instead of a store.
 *
 * A stable object, because `useSyncExternalStore` cannot tolerate a fresh
 * snapshot per call — and a state of its own rather than a `status:
 * 'unconfigured'` arm, because the STORE never has that state: "the Host wired
 * nothing" is not a phase of a load, so it is the provider's null that says it
 * and not a shape the store would have to carry.
 */
const NOTHING_WIRED: ExecutionsSnapshot = { list: { status: 'loading' }, open: { status: 'none' } }

const OPENING = { status: 'opening' } as const
const CATALOGUE_LOADING = { status: 'loading' } as const
const NO_MANIFESTS: Manifest[] = []

/**
 * The definition the run is drawn against, or null while the document on screen
 * is not one — which is a state the store is built to hold (ADR-0001) and this
 * pane degrades to naming Steps by id in.
 */
type Definition = WorkflowDefinition | null

// Module-level and therefore stable: useSyncExternalStore re-subscribes whenever
// `subscribe` changes identity.
const subscribeToNothing = () => () => {}
const readNothing = (): ExecutionsSnapshot => NOTHING_WIRED
const readOpening = (): EditingState => OPENING
const readCatalogueLoading = (): ManifestState => CATALOGUE_LOADING

export function RunStep({ className, selected, ...rest }: RunStepProps) {
  const runs = useExecutionStore()
  const editing = useEditingStore()
  const manifests = useManifestStore()

  const state = useSyncExternalStore<ExecutionsSnapshot>(
    runs ? runs.subscribe : subscribeToNothing,
    runs ? runs.getSnapshot : readNothing,
    readNothing,
  )

  const document = useSyncExternalStore<EditingState>(
    editing ? editing.subscribe : subscribeToNothing,
    editing ? editing.getSnapshot : readOpening,
    readOpening,
  )

  const catalogue = useSyncExternalStore<ManifestState>(
    manifests ? manifests.subscribe : subscribeToNothing,
    manifests ? manifests.getSnapshot : readCatalogueLoading,
    readCatalogueLoading,
  )

  /*
   * Idempotent, and it is the same call every region reading the document makes.
   *
   * `openDraft` claims the edit, and `ports.ts` warns that a Host mounting only
   * the run viewer must not take a lease — which is why the claim is a decision
   * rather than an accident here. A **Preview** can only be set over an open
   * session at all (the store refuses one while the workflow is still opening),
   * so a run on screen presupposes it; and a Host that wants a viewer with no
   * claim mounts the map and the list without this pane, which names Steps by
   * their ids and needs nothing.
   */
  useEffect(() => {
    editing?.open()
    /*
     * And the catalogue, because the metadata a run carries is values alone: the
     * manifest supplies each key's label, unit and whether it is a measure, so
     * without it a run's numbers have nothing to be called and no total to sum
     * into. Idempotent, so mounting this beside the **Components** tab fetches
     * once.
     */
    manifests?.load()
  }, [editing, manifests])

  /*
   * The definition the run is drawn against, which is the one on screen.
   *
   * Read off the editing snapshot rather than loaded again: the version an
   * execution references is put on screen as a **Preview** (ADR-0025), so
   * asking the store what is open IS asking what the run ran against. A second
   * `loadVersion` here would be a second document, which is the thing that
   * decision exists to avoid.
   */
  const definition = document.status === 'ready' ? document.workflow.definition : null

  const entries = catalogue.status === 'ready' ? catalogue.manifests : null
  const descriptors = useMemo(
    () => descriptorsByUse(entries ? manifestsIn(entries) : NO_MANIFESTS),
    [entries],
  )

  return (
    <section aria-label="Run" className={cx(styles.pane, className)} {...rest}>
      <style href="hatua-run-step" precedence="hatua">
        {css}
      </style>
      <Body
        wired={runs !== null}
        state={state}
        selected={selected ?? null}
        definition={definition}
        descriptors={descriptors}
      />
    </section>
  )
}

function Body({
  wired,
  state,
  selected,
  definition,
  descriptors,
}: {
  wired: boolean
  state: ExecutionsSnapshot
  selected: Segment | null
  definition: Definition
  descriptors: Map<string, MetadataDescriptor[]>
}) {
  if (!wired) {
    return (
      <p className={styles.said}>
        No run history is wired up. Hatua stores nothing of its own — a Host supplies runs as ports=
        {'{{ executions }}'}, and names which workflow they belong to as workflowId.
      </p>
    )
  }

  const { open } = state
  if (open.status === 'none') return <p className={styles.said}>Pick a run to see what happened.</p>
  if (open.status === 'loading') return <p className={styles.said}>Loading that run…</p>
  if (open.status === 'failed') {
    return <p className={cx(styles.said, styles.wrong)}>{open.error.message}</p>
  }

  const { execution } = open
  const steps = selected?.steps ?? []

  if (steps.length > 1) {
    // A Segment of several is a real selection with several records behind it,
    // and no way to draw them as one. Said rather than resolved by taking the
    // first, which would describe something other than what is highlighted.
    return <p className={styles.said}>Pick a single step to see what it did.</p>
  }

  const stepId = steps[0]
  if (stepId === undefined) {
    return <WholeRun execution={execution} descriptors={descriptors} definition={definition} />
  }

  return (
    <OneStep
      execution={execution}
      stepId={stepId}
      descriptors={descriptors}
      definition={definition}
    />
  )
}

function WholeRun({
  execution,
  descriptors,
  definition,
}: {
  execution: WorkflowExecution
  descriptors: Map<string, MetadataDescriptor[]>
  definition: Definition
}) {
  /*
   * Which Component each Step is, which is what says whose metadata keys the
   * values under it belong to.
   *
   * Answered from the definition on screen, which is the version the run
   * references — so a Step renamed or retyped since the run has no bearing on
   * it. A Step the definition does not hold contributes nothing, rather than
   * being counted under `undefined` and pairing one Component's measure with
   * another's dimension.
   */
  const measures = useMemo(
    () =>
      totals(execution, descriptors, (stepId) =>
        definition ? stepIn(definition.steps, stepId)?.use : undefined,
      ),
    [execution, descriptors, definition],
  )

  const trigger = execution.trigger

  return (
    <>
      <div className={styles.head}>
        <h2 className={styles.title}>This run</h2>
        <p className={styles.facts}>
          <span className={styles[execution.status] ?? ''}>
            {RUN_STATUS_LABEL[execution.status] ?? execution.status}
          </span>
          <span>{momentOf(execution.started_at)}</span>
          {execution.duration_ms !== undefined ? (
            <span>{durationOf(execution.duration_ms)}</span>
          ) : null}
        </p>
      </div>

      {trigger ? (
        <section className={styles.section}>
          <h3 className={styles.legend}>Trigger</h3>
          <dl className={styles.rows}>
            <dt className={styles.key}>Fired</dt>
            <dd className={styles.value}>{trigger.id}</dd>
          </dl>
          {trigger.payload ? <Payload label="Payload" value={trigger.payload} /> : null}
        </section>
      ) : null}

      {measures.length > 0 ? (
        <section className={styles.section}>
          {/* Derived, never reported: the schema has no run-level block, and
              this is what it says instead. */}
          <h3 className={styles.legend}>Totals</h3>
          <dl className={styles.rows}>
            {measures.map((measure) => (
              <Row
                key={measure.key}
                label={measure.label}
                value={`${measure.total}${measure.unit ? ` ${measure.unit}` : ''}`}
              />
            ))}
          </dl>
        </section>
      ) : null}

      <Log entries={execution.log ?? []} legend="Log" />
    </>
  )
}

function OneStep({
  execution,
  stepId,
  descriptors,
  definition,
}: {
  execution: WorkflowExecution
  stepId: string
  descriptors: Map<string, MetadataDescriptor[]>
  definition: Definition
}) {
  const step = definition ? stepIn(definition.steps, stepId) : undefined
  const records = recordsFor(execution, stepId)
  const status = statusOf(records)
  const keys = step?.use ? (descriptors.get(step.use) ?? []) : []

  /*
   * A Step under a loop has one record per pass, and the pane is where they
   * are. The head shows the worst of them, which is the same answer the card on
   * the map shows — one question, one function, so the two cannot disagree.
   */
  const passes = records.length > 1 ? records : []
  const only = records.length === 1 ? records[0] : undefined

  return (
    <>
      <div className={styles.head}>
        <h2 className={styles.title}>{step ? nameOf(step) : stepId}</h2>
        <p className={styles.facts}>
          {status ? (
            <span className={styles[status] ?? ''}>{STATUS_LABEL[status]}</span>
          ) : (
            // A Step the run never reached — inside a Branch that was not taken,
            // or after the failure that ended the run. The version on screen
            // still holds it, and saying nothing about it would read as a Step
            // that succeeded silently.
            <span>Did not run</span>
          )}
          {records.length > 1 ? <span>{`${records.length} passes`}</span> : null}
          {only?.duration_ms !== undefined ? <span>{durationOf(only.duration_ms)}</span> : null}
        </p>
      </div>

      {only ? <Record record={only} keys={keys} /> : null}

      {passes.length > 0 ? (
        <section className={styles.section}>
          <h3 className={styles.legend}>Passes</h3>
          <ul className={styles.passes}>
            {passes.map((record, index) => (
              <li
                // A pass is the nth time the Step ran, the schema's own `index`
                // lives on the iteration rather than on the record inside it,
                // and two passes of one Step are otherwise indistinguishable:
                // same id, same shape, often the same status.
                // biome-ignore lint/suspicious/noArrayIndexKey: the position is the identity here
                key={`${stepId}-${index}`}
                className={styles.pass}
              >
                <span className={styles.index}>#{index}</span>
                <span className={styles[record.status] ?? ''}>{STATUS_LABEL[record.status]}</span>
                <span className={styles.value}>
                  {record.error?.message ?? durationOf(record.duration_ms)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <Log entries={logFor(execution, stepId)} legend="Log" />
    </>
  )
}

function Record({ record, keys }: { record: StepRecord; keys: readonly MetadataDescriptor[] }) {
  const metadata = record.metadata ?? {}
  /*
   * Only the keys a manifest declares, and labelled the way it labels them.
   *
   * The record carries values alone, deliberately: "the manifest supplies the
   * label, type, unit, and whether each key is a measure or a dimension; this
   * carries only the values, so the UI renders any component's metadata
   * generically". A key the catalogue does not declare has no label and no unit,
   * so there is nothing honest to write beside it.
   */
  const declared = keys.filter((key) => metadata[key.k] !== undefined)

  return (
    <>
      {record.error ? (
        <section className={styles.section}>
          <h3 className={styles.legend}>Error</h3>
          <p className={styles.fault}>{record.error.message}</p>
          {record.error.code ? <p className={styles.code}>{record.error.code}</p> : null}
        </section>
      ) : null}

      {declared.length > 0 ? (
        <section className={styles.section}>
          <h3 className={styles.legend}>Metadata</h3>
          <dl className={styles.rows}>
            {declared.map((key) => (
              <Row
                key={key.k}
                label={key.label}
                value={`${String(metadata[key.k])}${key.unit ? ` ${key.unit}` : ''}`}
              />
            ))}
          </dl>
        </section>
      ) : null}

      {record.resolved_input !== undefined ? (
        <section className={styles.section}>
          {/* Every Reference replaced by the value it received, which is the one
              thing the definition cannot show: a Template says where a value
              comes from, and this says what arrived. */}
          <h3 className={styles.legend}>Input</h3>
          <Payload value={record.resolved_input} />
        </section>
      ) : null}

      {record.output !== undefined ? (
        <section className={styles.section}>
          <h3 className={styles.legend}>Output</h3>
          <Payload value={record.output} />
        </section>
      ) : null}
    </>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className={styles.key}>{label}</dt>
      <dd className={styles.value}>{value}</dd>
    </>
  )
}

/**
 * A payload, as JSON, coloured.
 *
 * `output` is `{}` in the schema — anything at all — so there is no shape to
 * render against and nothing to label the parts of. JSON is what it is, and a
 * box that scrolls in its own right is what keeps the widest run from widening
 * the column.
 *
 * `valueTokens` walks the value rather than stringifying and re-reading it: by
 * the time a payload is text, "was this a string or a number" is a question a
 * tokeniser has to guess at from quotes it has just written. It also handles the
 * shapes a Host can send that JSON has no syntax for — a cycle, a `BigInt`,
 * `NaN` — which is why nothing here has to catch.
 */
function Payload({ label, value }: { label?: string; value: unknown }) {
  return (
    <>
      {label ? <h3 className={styles.legend}>{label}</h3> : null}
      <Code className={styles.payload} tokens={valueTokens(value)} />
    </>
  )
}

function Log({
  entries,
  legend,
}: {
  entries: NonNullable<WorkflowExecution['log']>
  legend: string
}) {
  if (entries.length === 0) return null
  return (
    <section className={styles.section}>
      <h3 className={styles.legend}>{legend}</h3>
      <ul className={styles.log}>
        {entries.map((entry, index) => (
          <li
            // Two lines may carry the same moment, channel and message, and a
            // runner writing the same line twice is ordinary.
            // biome-ignore lint/suspicious/noArrayIndexKey: nothing else tells two entries apart
            key={`${entry.at}-${index}`}
            className={styles.entry}
          >
            <span className={styles.at}>{momentOf(entry.at)}</span>
            <span className={styles.message}>
              {entry.channel ? <span className={styles.channel}>{entry.channel} · </span> : null}
              {entry.message}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
