import {
  FIELD_KIND_TYPES,
  fieldVisible,
  type MappableFieldKind,
  type ScopeEntry,
} from '@hatua/model'
import type { Connection, Field, Manifest } from '@hatua/schema'
import { isMappable } from '@hatua/schema'
import type { ConnectionState } from '@hatua/services'
import { type ComponentPropsWithRef, useEffect, useId, useState, useSyncExternalStore } from 'react'
import { TemplateInput } from '../compounds/TemplateInput'
import { cx } from '../primitives/classNames'
import { Input } from '../primitives/Input'
import { Select } from '../primitives/Select'
import { Toggle } from '../primitives/Toggle'
import { useConnectionStore } from '../theme/HatuaProvider'
import styles from './Fields.module.css'
import css from './Fields.module.css?inline'

/**
 * The form for one Component Manifest's fields, over one set of values.
 *
 * **One form, wherever the thing being edited lives.** A Trigger's fields and a
 * Step's fields are the same shape declared by the same schema, and the only
 * difference is which key of the document they are written back to — so the
 * form takes values in and hands edits out, and knows nothing about Triggers,
 * Steps or the editing store.
 *
 * That is what makes "edit anything the same way" a rendering decision rather
 * than a document one. The Workflow tab mounts this today because it is the
 * only surface that exists; the step editor mounts the same component when it
 * lands, and clicking the canvas's start node reaches it without `triggers[]`
 * moving anywhere.
 *
 * ## Templates
 *
 * Every mappable kind gets `<TemplateInput>` — one widget shared by every site
 * that holds a Template, because building half of it per site is how the three
 * end up disagreeing about what `{{` does. What this form contributes is the
 * two things the widget cannot know on its own: what the field may read, and
 * what its value has to produce.
 */
export interface FieldsProps extends Omit<ComponentPropsWithRef<'div'>, 'onChange'> {
  /** Declares which fields exist. Absent when nothing declares this component's verb. */
  manifest: Manifest | undefined
  /** The `with:` map as the document holds it. */
  values: Record<string, unknown>
  /** The Connections the workflow declares, which is what a `conn` field stores. */
  connections: readonly Connection[]
  /**
   * Everything a Template in this form may read.
   *
   * A prop rather than something this form works out, because scope is a
   * question about a *position* — `scopeFor` for a Step, `workflowScope` for a
   * Trigger — and which of those applies is exactly what "one form, wherever
   * the thing being edited lives" means this form must not know.
   *
   * Defaults to empty rather than being required, because a Host that wired a
   * `WorkflowStore` and no `ManifestSource` still edits every field it has: the
   * completion offers nothing, and the text stays typeable.
   */
  scope?: readonly ScopeEntry[]
  onChange: (key: string, value: string | number | boolean) => void
  /**
   * Bind one of the Host's Connections to a workflow-local name and point the
   * field at it, as a single edit.
   *
   * Separate from `onChange` because it writes two places in the document, and
   * the caller is what owns the command that does it.
   */
  onDeclareConnection?: (key: string, id: string, ref: string) => void
}

export function Fields({
  manifest,
  values,
  connections,
  scope = NO_SCOPE,
  onChange,
  onDeclareConnection,
  className,
  ...rest
}: FieldsProps) {
  const established = useEstablished()

  if (!manifest) return null

  // `fieldVisible` rather than a copy of the rule: the same predicate decides
  // whether a required field counts as missing, and two copies are two answers
  // waiting to disagree — a hidden field that starts blocking Publish, or a
  // visible required one that stops being reported.
  const shown = (manifest.fields ?? []).filter((field) => fieldVisible(field, values))
  if (shown.length === 0) return null

  return (
    <>
      <style href="hatua-fields" precedence="hatua">
        {css}
      </style>
      <div className={cx(styles.fields, className)} {...rest}>
        {shown.map((field) => (
          <FieldRow
            key={field.k}
            field={field}
            value={values[field.k]}
            connections={connections}
            scope={scope}
            established={established}
            onChange={(next) => onChange(field.k, next)}
            onDeclareConnection={
              onDeclareConnection && ((id, ref) => onDeclareConnection(field.k, id, ref))
            }
          />
        ))}
      </div>
    </>
  )
}

/**
 * The Host's Connections, subscribed to once for the whole form.
 *
 * Per field it would be one subscription and one `load()` per `conn` field on
 * the screen, and two fields looking at the same Connection would carry two
 * independent loading states. The store dedupes the fetch either way; what it
 * cannot dedupe is the render.
 */
function useEstablished(): PickerState {
  const store = useConnectionStore()

  // The one side effect: tell the store somebody is reading. Idempotent, so
  // every form that mounts may call it and only the first fetches.
  useEffect(() => {
    store?.load()
  }, [store])

  return useSyncExternalStore<PickerState>(
    store ? store.subscribe : subscribeToNothing,
    store ? store.getSnapshot : readUnconfigured,
    store ? readLoading : readUnconfigured,
  )
}

/**
 * An input that holds what the user is typing and commits on blur.
 *
 * Controlled from the document it would fight the user: every keystroke is a
 * command, a command is a write, and a write re-parses — so the caret jumps to
 * the end on every letter. Held locally and committed once, the document sees
 * the value the user settled on.
 *
 * It still follows the document when the document moves under it — an undo, or
 * another region's edit. `committed` is the last value this input either
 * received or sent, so a change arriving from anywhere else is distinguishable
 * from the echo of its own edit.
 */
export function CommittedInput({
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
    // Set during render rather than in an effect: an effect would paint the
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
 * What a `number` field's box stores.
 *
 * `Number('')` is 0, so emptying the box would write a zero — and `unfilled()`
 * counts 0 as answered, so a required numeric field would silently stop being
 * reported as missing while reading as answered to the person who just cleared
 * it. `Number('abc')` is NaN, which serialises into the document as something
 * no reader can act on. Both stay as the text the user typed, which is a state
 * the checker already knows how to talk about.
 */
const numberIfAsked = (field: Field, text: string): string | number => {
  if (field.kind !== 'number') return text
  const parsed = Number(text)
  return text.trim() === '' || !Number.isFinite(parsed) ? text : parsed
}

/**
 * What a `conn` field may offer: the names this workflow declares, and the
 * Host's Connections it has not bound yet.
 *
 * Computed here rather than inside the picker because the row above has to know
 * whether there will be a control at all — `<label htmlFor>` may only point at
 * a labelable element, and a picker with nothing to offer is a sentence.
 */
function connectionOptions({
  field,
  value,
  connections,
  established,
  bindable: canBind,
}: {
  field: Field
  value: string
  connections: readonly Connection[]
  established: PickerState
  bindable: boolean
}) {
  const known = established.status === 'ready' ? established.connections : []
  const byRef = new Map(known.map((connection) => [connection.ref, connection]))

  // Only what this field may hold. `conn_type` is the whole point of the field
  // kind: a Connection whose type does not match cannot be used here, and
  // offering it would be offering a choice `mismatchedConnections` then blocks
  // editing over.
  const fits = (type: string | undefined) => !field.conn_type || type === field.conn_type

  const declared = connections.filter((connection) => {
    if (connection.id === value) return true
    const described = connection.ref ? byRef.get(connection.ref) : undefined
    // An undeclared type is offered: the workflow declares this Connection, and
    // hiding it because a description did not arrive would empty the picker on
    // a slow network.
    return described ? fits(described.type) : true
  })

  const boundRefs = new Set(connections.map((connection) => connection.ref))
  const bindable = canBind
    ? known.filter((connection) => fits(connection.type) && !boundRefs.has(connection.ref))
    : []

  return { byRef, declared, bindable }
}

function FieldRow({
  field,
  value,
  connections,
  scope,
  established,
  onChange,
  onDeclareConnection,
}: {
  field: Field
  value: unknown
  connections: readonly Connection[]
  scope: readonly ScopeEntry[]
  established: PickerState
  onChange: (next: string | number | boolean) => void
  onDeclareConnection?: (id: string, ref: string) => void
}) {
  const id = useId()
  const labelId = `${id}-label`
  const text = value === undefined || value === null ? '' : String(value)

  /**
   * Whether this row ends up holding a real form control.
   *
   * `<label htmlFor>` may only point at a labelable element, and two of these
   * rows do not produce one: a `map` is shown and not edited, and a `conn` field
   * degrades to a sentence while the Connections are loading, when the Host
   * wired no port, or when none of them fits. A label pointing at a `<p>` is
   * inert — clicking it does nothing, and a screen reader reads the label and
   * the sentence as two unrelated things.
   *
   * So the label is a `<label>` when there is something to label and a `<span>`
   * the text points back at when there is not.
   */
  const options =
    field.kind === 'conn'
      ? connectionOptions({
          field,
          value: text,
          connections,
          established,
          bindable: Boolean(onDeclareConnection),
        })
      : null

  const offers = Boolean(options && options.declared.length + options.bindable.length > 0)
  const labelable = field.kind !== 'map' && (field.kind !== 'conn' || offers)

  const control =
    field.kind === 'conn' && options ? (
      <ConnectionField
        id={id}
        labelledBy={labelId}
        field={field}
        value={text}
        connections={connections}
        established={established}
        options={options}
        onChange={onChange}
        onDeclare={onDeclareConnection}
      />
    ) : field.kind === 'bool' ? (
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
        className={cx(field.mono && styles.mono)}
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
    ) : field.kind === 'map' ? null : isMappable(field.kind) ? (
      <TemplateInput
        id={id}
        label={field.label}
        value={text}
        placeholder={field.ph}
        scope={scope}
        expectedType={declaredType(field.kind as MappableFieldKind)}
        // A `ref` field holds exactly one Reference — for-each's list, Filter's
        // list — so a drop replaces rather than appends.
        single={field.kind === 'ref'}
        multiline={field.kind === 'textarea'}
        onCommit={(next) => onChange(numberIfAsked(field, next))}
      />
    ) : (
      <CommittedInput
        id={id}
        label={field.label}
        value={text}
        placeholder={field.ph}
        mono={field.kind === 'secret'}
        type={field.kind === 'secret' ? 'password' : 'text'}
        onCommit={(next) => onChange(numberIfAsked(field, next))}
      />
    )

  const label = (
    <>
      {field.label}
      {field.req ? (
        <span className={styles.required} aria-hidden="true">
          *
        </span>
      ) : null}
    </>
  )

  return (
    <div className={styles.field}>
      {labelable ? (
        <label className={styles.label} htmlFor={id}>
          {label}
        </label>
      ) : (
        <span className={styles.label} id={labelId}>
          {label}
        </span>
      )}
      {control ?? <UneditableField field={field} value={text} labelledBy={labelId} />}
      {field.hint ? <p className={styles.hint}>{field.hint}</p> : null}
    </div>
  )
}

/**
 * A `map` field, shown and not edited.
 *
 * A `map` holds a list of `{key, value, type}` entries the user builds, and it
 * decides a Step's outputs — `core.map` is the component it exists for, and
 * editing one is the step editor's own widget rather than a row in this form.
 * What it must not do is render nothing: a field drawn as an empty space is
 * indistinguishable from one this form does not know about, and a required one
 * left unset would be reported by the checker with nothing on screen to act on.
 */
function UneditableField({
  field,
  value,
  labelledBy,
}: {
  field: Field
  value: string
  labelledBy: string
}) {
  return (
    // `role="note"` because the row's label is a <span> here, not a <label>:
    // `<label htmlFor>` may only point at a labelable element and this is not
    // one, and `aria-labelledby` needs a role that supports it. Without both,
    // the label and this text are read as two unrelated things.
    <div className={styles.uneditable} role="note" aria-labelledby={labelledBy}>
      {value ? <code className={styles.mono}>{value}</code> : 'Nothing set.'}{' '}
      {field.kind === 'map' ? 'Entries are edited where the step is.' : null}
    </div>
  )
}

const NO_SCOPE: readonly ScopeEntry[] = []

/**
 * What a field's value has to produce, as the left rail judges it.
 *
 * `unknown` becomes *nothing to judge against* rather than being passed
 * through. `match()` reads a declared `unknown` as "everything fits", so a
 * `ref` field would mark every row in the list green — and a rail that is
 * always green carries no more information than one that is never green, while
 * looking like it carries some.
 */
const declaredType = (kind: MappableFieldKind) => {
  const declared = FIELD_KIND_TYPES[kind]
  return declared === 'unknown' ? undefined : declared
}

const NO_CONNECTIONS = { status: 'unconfigured' } as const
const CONNECTIONS_LOADING = { status: 'loading' } as const

type PickerState = ConnectionState | { status: 'unconfigured' }

const subscribeToNothing = () => () => {}
const readUnconfigured = (): PickerState => NO_CONNECTIONS
const readLoading = (): PickerState => CONNECTIONS_LOADING

/**
 * Turn a Connection's label into a workflow-local name.
 *
 * The name lands in a Workflow Definition that lives in the Host's repository
 * and is read in `{{ … }}` nowhere but a `conn` field, so it only has to be
 * stable, unique and readable in a diff. Derived from the label rather than
 * from the ref because the ref is opaque by design.
 */
const nameFor = (label: string, taken: ReadonlySet<string>): string => {
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'connection'
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) {
    const candidate = `${base}_${n}`
    if (!taken.has(candidate)) return candidate
  }
}

/**
 * A `conn` field: which of the Host's Connections this uses.
 *
 * The value stored is the workflow-local NAME, never the Host's handle —
 * `connections[]` holds the `ref` once and every field points at the id, which
 * is what lets the Host rename a Connection without touching a field. So the
 * picker offers two things at once: the names this workflow already declares,
 * and the Host's Connections it has not bound yet. Picking the second declares
 * it and points the field at it, as one edit.
 *
 * Filtered by `conn_type` throughout, so a "send email" step is never handed an
 * LLM connection. A Connection whose type the Host would not describe is
 * offered anyway rather than hidden: `mismatchedConnections` reports a genuine
 * mismatch, and silently dropping the only Connection someone has is worse than
 * offering it.
 */
function ConnectionField({
  id,
  labelledBy,
  field,
  value,
  connections,
  established,
  options,
  onChange,
  onDeclare,
}: {
  id: string
  /** Where the row's label lives while this renders a sentence rather than a control. */
  labelledBy: string
  field: Field
  value: string
  connections: readonly Connection[]
  established: PickerState
  options: ReturnType<typeof connectionOptions>
  onChange: (next: string) => void
  onDeclare?: (name: string, ref: string) => void
}) {
  const { byRef, declared, bindable } = options

  const takenNames = new Set(connections.map((connection) => connection.id))

  const choose = (next: string) => {
    const binding = bindable.find((connection) => `+${connection.ref}` === next)
    if (!binding) {
      onChange(next)
      return
    }
    onDeclare?.(nameFor(binding.label, takenNames), binding.ref)
  }

  if (established.status === 'loading') {
    return (
      <div className={styles.uneditable} role="note" aria-labelledby={labelledBy}>
        Loading connections…
      </div>
    )
  }

  if (declared.length === 0 && bindable.length === 0) {
    return (
      <div className={styles.uneditable} role="note" aria-labelledby={labelledBy}>
        {established.status === 'failed'
          ? `Connections could not be loaded. ${established.error.message}`
          : 'No connection is available for this yet.'}
      </div>
    )
  }

  return (
    <Select id={id} value={value} aria-label={field.label} onChange={(e) => choose(e.target.value)}>
      <option value="">—</option>
      {declared.map((connection) => (
        <option key={connection.id} value={connection.id}>
          {labelFor(connection, byRef.get(connection.ref ?? ''))}
        </option>
      ))}
      {bindable.length > 0 ? (
        <optgroup label="Not used in this workflow yet">
          {bindable.map((connection) => (
            <option key={connection.ref} value={`+${connection.ref}`}>
              {connection.label}
            </option>
          ))}
        </optgroup>
      ) : null}
    </Select>
  )
}

/**
 * What a declared Connection is called on screen.
 *
 * The Host's description wins: the workflow-local name is a key in a file, and
 * what a person recognises is whatever the Host calls the thing it points at. A
 * Connection with no `ref` was never established, which blocks Publish and not
 * editing — so it is offered, and said to be unfinished rather than hidden.
 */
const labelFor = (connection: Connection, described?: { label: string }): string => {
  if (!connection.ref) return `${connection.id} — not connected yet`
  return described ? `${described.label}` : connection.id
}
