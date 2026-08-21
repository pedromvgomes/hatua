import { fieldVisible } from '@hatua/model'
import type { Connection, Field, Manifest } from '@hatua/schema'
import type { ConnectionState } from '@hatua/services'
import { type ComponentPropsWithRef, useEffect, useId, useState, useSyncExternalStore } from 'react'
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
 * ## What it does not do
 *
 * Templates. The kinds that accept an Expression get a plain mono input here —
 * the Template input, with its highlighting, completion and picker, is one
 * widget shared by every site that holds a Template, and building half of it in
 * one of those sites is how the three end up disagreeing.
 */
export interface FieldsProps extends Omit<ComponentPropsWithRef<'div'>, 'onChange'> {
  /** Declares which fields exist. Absent when nothing declares this component's verb. */
  manifest: Manifest | undefined
  /** The `with:` map as the document holds it. */
  values: Record<string, unknown>
  /** The Connections the workflow declares, which is what a `conn` field stores. */
  connections: readonly Connection[]
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
  onChange,
  onDeclareConnection,
  className,
  ...rest
}: FieldsProps) {
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

function FieldRow({
  field,
  value,
  connections,
  onChange,
  onDeclareConnection,
}: {
  field: Field
  value: unknown
  connections: readonly Connection[]
  onChange: (next: string | number | boolean) => void
  onDeclareConnection?: (id: string, ref: string) => void
}) {
  const id = useId()
  const text = value === undefined || value === null ? '' : String(value)

  const control =
    field.kind === 'conn' ? (
      <ConnectionField
        id={id}
        field={field}
        value={text}
        connections={connections}
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
    ) : field.kind === 'textarea' ? (
      <CommittedTextarea id={id} label={field.label} value={text} onCommit={onChange} />
    ) : field.kind === 'map' ? null : (
      <CommittedInput
        id={id}
        label={field.label}
        value={text}
        placeholder={field.ph}
        mono={field.kind === 'mono' || field.kind === 'ref' || field.kind === 'secret'}
        type={field.kind === 'number' ? 'number' : field.kind === 'secret' ? 'password' : 'text'}
        onCommit={(next) => onChange(numberIfAsked(field, next))}
      />
    )

  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {field.label}
        {field.req ? (
          <span className={styles.required} aria-hidden="true">
            *
          </span>
        ) : null}
      </label>
      {control ?? <UneditableField field={field} value={text} />}
      {field.hint ? <p className={styles.hint}>{field.hint}</p> : null}
    </div>
  )
}

/**
 * A `map` field, shown and not edited.
 *
 * A `map` holds a list of `{key, value, type}` entries the user builds, and it
 * decides a Step's outputs — `data.map` is the component it exists for, and
 * editing one is the step editor's own widget rather than a row in this form.
 * What it must not do is render nothing: a field drawn as an empty space is
 * indistinguishable from one this form does not know about, and a required one
 * left unset would be reported by the checker with nothing on screen to act on.
 */
function UneditableField({ field, value }: { field: Field; value: string }) {
  return (
    <p className={styles.uneditable}>
      {value ? <code className={styles.mono}>{value}</code> : 'Nothing set.'}{' '}
      {field.kind === 'map' ? 'Entries are edited where the step is.' : null}
    </p>
  )
}

function CommittedTextarea({
  id,
  label,
  value,
  onCommit,
}: {
  id: string
  label: string
  value: string
  onCommit: (next: string) => void
}) {
  const [draft, setDraft] = useState(value)
  const [committed, setCommitted] = useState(value)

  if (value !== committed) {
    setCommitted(value)
    setDraft(value)
  }

  return (
    <textarea
      id={id}
      aria-label={label}
      className={cx(styles.textarea, styles.mono)}
      value={draft}
      rows={3}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (draft === committed) return
        setCommitted(draft)
        onCommit(draft)
      }}
    />
  )
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
  field,
  value,
  connections,
  onChange,
  onDeclare,
}: {
  id: string
  field: Field
  value: string
  connections: readonly Connection[]
  onChange: (next: string) => void
  onDeclare?: (name: string, ref: string) => void
}) {
  const store = useConnectionStore()

  // The one side effect: tell the store somebody is reading. Idempotent, so
  // every `conn` field on the screen may call it and only the first fetches —
  // which is the whole reason the list is a store rather than a fetch inside
  // this component.
  useEffect(() => {
    store?.load()
  }, [store])

  const state = useSyncExternalStore<PickerState>(
    store ? store.subscribe : subscribeToNothing,
    store ? store.getSnapshot : readUnconfigured,
    store ? readLoading : readUnconfigured,
  )

  const known = state.status === 'ready' ? state.connections : []
  const byRef = new Map(known.map((connection) => [connection.ref, connection]))

  // Only what this field may hold. `conn_type` is the whole point of the field
  // kind: a Connection whose type does not match cannot be used here, and
  // offering it would be offering a choice `mismatchedConnections` then blocks
  // editing over.
  const fits = (type: string | undefined) => !field.conn_type || type === field.conn_type

  const declared = connections.filter((connection) => {
    if (connection.id === value) return true
    const described = connection.ref ? byRef.get(connection.ref) : undefined
    // An undescribed Connection is offered: the Host listed it or the workflow
    // declares it, and hiding it because a description did not arrive would
    // empty the picker on a slow network.
    return described ? fits(described.type) : true
  })

  const takenNames = new Set(connections.map((connection) => connection.id))
  const boundRefs = new Set(connections.map((connection) => connection.ref))
  const bindable = onDeclare
    ? known.filter((connection) => fits(connection.type) && !boundRefs.has(connection.ref))
    : []

  const choose = (next: string) => {
    const binding = bindable.find((connection) => `+${connection.ref}` === next)
    if (!binding) {
      onChange(next)
      return
    }
    onDeclare?.(nameFor(binding.label, takenNames), binding.ref)
  }

  if (state.status === 'loading') {
    return <p className={styles.uneditable}>Loading connections…</p>
  }

  if (declared.length === 0 && bindable.length === 0) {
    return (
      <p className={styles.uneditable}>
        {state.status === 'failed'
          ? `Connections could not be loaded. ${state.error.message}`
          : 'No connection is available for this yet.'}
      </p>
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
