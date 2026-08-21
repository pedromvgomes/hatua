import type { Field, Manifest, Trigger, Variable } from '@hatua/schema'
import {
  addTrigger,
  addVariable,
  type EditingState,
  type ManifestState,
  removeTrigger,
  removeVariable,
  renameVariable,
  setTriggerField,
  setTriggerName,
  setVariableValue,
  setWorkflowName,
  setWorkflowSlug,
} from '@hatua/services'
import {
  type ComponentPropsWithRef,
  type ReactNode,
  useEffect,
  useId,
  useState,
  useSyncExternalStore,
} from 'react'
import { Button } from '../primitives/Button'
import { cx } from '../primitives/classNames'
import { Input } from '../primitives/Input'
import { Select } from '../primitives/Select'
import { Toggle } from '../primitives/Toggle'
import { useEditingStore, useManifestStore } from '../theme/HatuaProvider'
import styles from './Workflow.module.css'
import css from './Workflow.module.css?inline'

/**
 * The Workflow tab: everything scoped to the workflow rather than to a Step.
 *
 * Three sections — the name and slug, the Triggers, the variables — and one
 * thing they have in common: none of them is addressed by a position in the
 * Step tree. That is what makes them one region rather than three, and it is
 * why the Flow tab beside it holds none of them.
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
 * ## Where the document comes from
 *
 * Not from props. Both embeddings mount this region bare —
 * `apps/playground/src/host.tsx` writes `<Workflow />` and
 * `layouts/regions.test.tsx` renders it with nothing above it — so a document
 * prop would break the promise those two exist to keep. Every edit goes through
 * the editing store as a command, which is what makes an edit here and a text
 * edit the same edit.
 */
export type WorkflowProps = ComponentPropsWithRef<'section'>

/** "The Host wired nothing" is not a phase of the load, so it is not the store's to report. */
type PanelState = EditingState | { status: 'unconfigured' }

const UNCONFIGURED = { status: 'unconfigured' } as const
const OPENING = { status: 'opening' } as const
const CATALOGUE_UNCONFIGURED = { status: 'unconfigured' } as const
const CATALOGUE_LOADING = { status: 'loading' } as const
const NO_MANIFESTS: Manifest[] = []

// Module-level and therefore stable: useSyncExternalStore re-subscribes
// whenever `subscribe` changes identity, and re-renders forever if `getSnapshot`
// returns a fresh object each call.
const subscribeToNothing = () => () => {}
const readUnconfigured = (): PanelState => UNCONFIGURED
const readOpening = (): PanelState => OPENING
const readCatalogueUnconfigured = (): CatalogueState => CATALOGUE_UNCONFIGURED
const readCatalogueLoading = (): CatalogueState => CATALOGUE_LOADING

type CatalogueState = ManifestState | { status: 'unconfigured' }

export function Workflow({ className, ...rest }: WorkflowProps) {
  const store = useEditingStore()
  const manifests = useManifestStore()

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

  const workflow = state.status === 'ready' ? state.workflow : null
  const definition = workflow?.definition ?? null
  const served = catalogue.status === 'ready' ? catalogue.manifests : NO_MANIFESTS

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
      <section aria-label="Workflow" className={cx(styles.workflow, className)} {...rest}>
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

          {definition ? (
            <>
              <Identity
                name={definition.name}
                slug={definition.id}
                onName={(next) => store?.apply(setWorkflowName(next))}
                onSlug={(next) => store?.apply(setWorkflowSlug(next))}
              />
              <Triggers
                triggers={definition.triggers ?? []}
                catalogue={catalogue}
                manifests={served}
                onAdd={(manifest) =>
                  store?.apply(addTrigger({ use: manifest.use, name: manifest.name }))
                }
                onRemove={(id) => store?.apply(removeTrigger(id))}
                onName={(id, name) => store?.apply(setTriggerName(id, name))}
                onField={(id, key, value) => store?.apply(setTriggerField(id, key, value))}
              />
              <Variables
                variables={definition.vars ?? []}
                onAdd={() => store?.apply(addVariable())}
                onRemove={(key) => store?.apply(removeVariable(key))}
                onRename={(from, to) => store?.apply(renameVariable(from, to))}
                onValue={(key, value) => store?.apply(setVariableValue(key, value))}
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
 * An input that holds what the user is typing and commits on blur.
 *
 * Controlled from the document it would fight the user: every keystroke is a
 * command, a command is a write, and a write re-parses — so the caret jumps to
 * the end and a half-typed key like `dige` is a rename in its own right. Held
 * locally and committed once, the document sees the value the user settled on.
 *
 * It follows the document when the document moves under it — an undo, or
 * another region's edit — which is what the effect below is for. `committed` is
 * the last value this input either received or sent, so a change arriving from
 * anywhere else is distinguishable from the echo of its own edit.
 */
function CommittedInput({
  value,
  onCommit,
  label,
  mono = false,
  ...rest
}: {
  value: string
  onCommit: (next: string) => void
  label: string
  mono?: boolean
} & Omit<ComponentPropsWithRef<'input'>, 'value' | 'onChange' | 'onBlur'>) {
  const [draft, setDraft] = useState(value)
  const [committed, setCommitted] = useState(value)

  if (value !== committed) {
    // Rendered rather than deferred to an effect: an effect would paint the
    // stale value first, so an undo would flash the old text before correcting
    // itself. React re-renders immediately when state is set during render.
    setCommitted(value)
    setDraft(value)
  }

  const commit = () => {
    if (draft === committed) return
    setCommitted(draft)
    onCommit(draft)
  }

  return (
    <Input
      {...rest}
      aria-label={label}
      className={cx(mono && styles.mono, rest.className)}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') commit()
        if (event.key === 'Escape') setDraft(committed)
      }}
    />
  )
}

/**
 * The name and the slug.
 *
 * A 304px panel with two labelled fields is a better place to rename a workflow
 * than an inline-edited breadcrumb, and it keeps the top bar to display.
 */
function Identity({
  name,
  slug,
  onName,
  onSlug,
}: {
  name: string
  slug: string
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
        <CommittedInput id={nameId} label="Name" value={name} onCommit={onName} />
      </div>
      <div className={styles.field}>
        <label className={styles.label} htmlFor={slugId}>
          Slug
        </label>
        <CommittedInput id={slugId} label="Slug" value={slug} mono onCommit={onSlug} />
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
  onAdd,
  onRemove,
  onName,
  onField,
}: {
  triggers: readonly Trigger[]
  catalogue: CatalogueState
  manifests: readonly Manifest[]
  onAdd: (manifest: Manifest) => void
  onRemove: (id: string) => void
  onName: (id: string, name: string) => void
  onField: (id: string, key: string, value: string | number | boolean) => void
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
          <li key={trigger.id} className={styles.trigger}>
            <TriggerCard
              trigger={trigger}
              manifest={byUse.get(trigger.use)}
              onRemove={onRemove}
              onName={onName}
              onField={onField}
            />
          </li>
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
      <Button size="sm" onClick={() => chosen && onAdd(chosen)}>
        Add trigger
      </Button>
    </div>
  )
}

function TriggerCard({
  trigger,
  manifest,
  onRemove,
  onName,
  onField,
}: {
  trigger: Trigger
  manifest: Manifest | undefined
  onRemove: (id: string) => void
  onName: (id: string, name: string) => void
  onField: (id: string, key: string, value: string | number | boolean) => void
}) {
  const values = (trigger.with ?? {}) as Record<string, unknown>
  const fields = (manifest?.fields ?? []).filter((field) => visible(field, values))

  return (
    <div className={styles.card}>
      <div className={styles.cardHead}>
        <CommittedInput
          label={`Name of ${trigger.name || trigger.id}`}
          value={trigger.name ?? ''}
          placeholder={manifest?.name ?? trigger.use}
          onCommit={(next) => onName(trigger.id, next)}
        />
        <button
          type="button"
          className={styles.remove}
          aria-label={`Remove ${trigger.name || trigger.id}`}
          onClick={() => onRemove(trigger.id)}
        >
          {/*
            A bin, not a cross. `×` is the glyph for dismissing a thing —
            closing a panel, clearing a filter — and this deletes a Trigger out
            of the document. Drawn rather than set in type: the only bin in a
            text font is an emoji, which renders at a size and colour the row
            does not control.
          */}
          <svg
            className={styles.icon}
            viewBox="0 0 16 16"
            width="14"
            height="14"
            focusable="false"
            aria-hidden="true"
          >
            <path d="M3 4.5h10M6.5 4.5V3.2a.7.7 0 0 1 .7-.7h1.6a.7.7 0 0 1 .7.7v1.3" />
            <path d="M4.4 4.5l.6 8a1 1 0 0 0 1 .9h4a1 1 0 0 0 1-.9l.6-8" />
            <path d="M6.8 7v3.6M9.2 7v3.6" />
          </svg>
        </button>
      </div>

      {/* The verb and the id, mono, because both are what a Template writes:
          `{{ triggers.t1.… }}` addresses this row by the id shown here. */}
      <p className={styles.meta}>
        {trigger.use} · {trigger.id}
      </p>

      {manifest ? (
        fields.map((field) => (
          <TriggerField
            key={field.k}
            field={field}
            value={values[field.k]}
            onChange={(next) => onField(trigger.id, field.k, next)}
          />
        ))
      ) : (
        <p className={styles.empty}>Nothing declares this trigger type, so it has no settings.</p>
      )}
    </div>
  )
}

/**
 * A field hidden by its `when` clause is not rendered.
 *
 * `when: [otherKey, value]` shows a field only while another field equals a
 * value — it is how one trigger component reshapes its form across schedule,
 * API and upstream modes. The same predicate decides whether a required field
 * counts as missing, in @hatua/model.
 */
const visible = (field: Field, values: Record<string, unknown>): boolean => {
  if (!field.when) return true
  const [key, expected] = field.when
  return String(values[key as string] ?? '') === expected
}

/**
 * One of a Trigger's declared fields.
 *
 * The kinds that accept an Expression get a plain mono input here. The Template
 * input — highlighting, completion, the picker — is one widget used by every
 * site that holds a Template, and building half of it in one of those sites is
 * how the three end up disagreeing.
 *
 * `conn`, `secret` and `map` have no control here. A `conn` needs the Host
 * asked to describe its handles (ADR-0007), a `map` is a list of typed entries
 * rather than a value, and a `secret` in a file that lives in a repository is
 * the thing the schema warns against on `ref`. A required one left unset is
 * already reported by the checker, which is the mechanism for saying so.
 */
function TriggerField({
  field,
  value,
  onChange,
}: {
  field: Field
  value: unknown
  onChange: (next: string | number | boolean) => void
}) {
  const id = useId()
  const text = value === undefined || value === null ? '' : String(value)

  const control =
    field.kind === 'bool' ? (
      <Toggle
        id={id}
        checked={value === true}
        onCheckedChange={onChange}
        aria-label={field.label}
      />
    ) : field.kind === 'enum' ? (
      <Select
        id={id}
        value={text}
        aria-label={field.label}
        onChange={(event) => onChange(event.target.value)}
      >
        {/* An unset enum needs somewhere to sit, or the <select> reports the
            first option as chosen when nothing was. */}
        <option value="">—</option>
        {(field.options ?? []).map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
    ) : field.kind === 'conn' || field.kind === 'secret' || field.kind === 'map' ? null : (
      <CommittedInput
        id={id}
        label={field.label}
        value={text}
        placeholder={field.ph}
        mono={field.kind === 'mono' || field.kind === 'ref'}
        type={field.kind === 'number' ? 'number' : 'text'}
        onCommit={(next) => onChange(field.kind === 'number' ? Number(next) : next)}
      />
    )

  if (!control) return null

  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {field.label}
      </label>
      {control}
      {field.hint ? <p className={styles.hint}>{field.hint}</p> : null}
    </div>
  )
}

/**
 * The workflow's variables: a key and a Template, per row.
 *
 * **A variable field is the one input with no type marking**, because `varType`
 * infers a variable's type *from* its value. There is nothing to check it
 * against — and editing one therefore changes what every downstream Expression
 * reading it type-checks against, which is correct.
 *
 * **Renaming a key does not rewrite References.** `{{ var.old_name }}` goes
 * stale and the checker reports it, exactly as it does for a Step that was
 * removed. Rewriting every Template on a keystroke would edit the user's file
 * in places they are not looking, and mid-typing every intermediate key is a
 * rename too.
 */
function Variables({
  variables,
  onAdd,
  onRemove,
  onRename,
  onValue,
}: {
  variables: readonly Variable[]
  onAdd: () => void
  onRemove: (key: string) => void
  onRename: (from: string, to: string) => void
  onValue: (key: string, value: string) => void
}) {
  return (
    <Section heading="Variables">
      <p className={styles.blurb}>
        Values this workflow keeps, read anywhere as{' '}
        <code className={styles.code}>{'{{ var.name }}'}</code>.
      </p>

      {variables.length === 0 ? <p className={styles.empty}>No variables yet.</p> : null}

      {variables.length > 0 ? (
        <ul className={styles.variables}>
          {variables.map((variable) => (
            <li key={variable.key} className={styles.variable}>
              <CommittedInput
                label={`Name of ${variable.key}`}
                className={styles.key}
                value={variable.key}
                mono
                onCommit={(next) => next && next !== variable.key && onRename(variable.key, next)}
              />
              <CommittedInput
                label={`Value of ${variable.key}`}
                value={
                  variable.value === undefined || variable.value === null
                    ? ''
                    : String(variable.value)
                }
                mono
                onCommit={(next) => onValue(variable.key, next)}
              />
              <button
                type="button"
                className={styles.remove}
                aria-label={`Remove ${variable.key}`}
                onClick={() => onRemove(variable.key)}
              >
                <svg
                  className={styles.icon}
                  viewBox="0 0 16 16"
                  width="14"
                  height="14"
                  focusable="false"
                  aria-hidden="true"
                >
                  <path d="M3 4.5h10M6.5 4.5V3.2a.7.7 0 0 1 .7-.7h1.6a.7.7 0 0 1 .7.7v1.3" />
                  <path d="M4.4 4.5l.6 8a1 1 0 0 0 1 .9h4a1 1 0 0 0 1-.9l.6-8" />
                  <path d="M6.8 7v3.6M9.2 7v3.6" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <Button size="sm" onClick={onAdd}>
        Add variable
      </Button>
    </Section>
  )
}
