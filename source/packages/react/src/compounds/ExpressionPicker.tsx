import type { FunctionSpec, ValueType } from '@hatua/expressions'
import { CORE_NAMESPACES } from '@hatua/expressions'
import type { ScopeEntry } from '@hatua/model'
import { useMemo, useState } from 'react'
import { Button } from '../primitives/Button'
import { cx } from '../primitives/classNames'
import { Input } from '../primitives/Input'
import { type Anchor, place } from '../primitives/placement'
import { Select } from '../primitives/Select'
import {
  type Candidate,
  FUNCTION_CANDIDATES,
  flatten,
  type RefNode,
  referenceTree,
} from './candidates'
import styles from './ExpressionPicker.module.css'
import css from './ExpressionPicker.module.css?inline'
import { dragPayload, fits } from './insertion'

/**
 * The browsable half: a 392px panel with two tabs.
 *
 * Two surfaces and not one, deliberately. A tabbed panel appearing on every
 * keystroke would be unusable, and a compact caret-anchored list is a poor
 * place to browse. What is identical is the candidates and the insert
 * semantics — both come from `candidates.ts`, which is why "one set of
 * candidates" is a fact rather than an intention.
 *
 * **Reference** and **Function** are the two shapes an Expression can take. Not
 * "Variable": the glossary lists that on Reference's *Avoid* line, and it would
 * be wrong anyway, because the tree holds Step outputs, Trigger payloads and
 * Run Context alongside variables.
 *
 * A tab strip rather than opening onto References with a link across: there are
 * three entry points and two modes, and a link would bury the half that most
 * needs discovering.
 */
export interface ExpressionPickerProps {
  scope: readonly ScopeEntry[]
  /** What an insertion here has to produce, or undefined where nothing declares one. */
  expected: ValueType | undefined
  /** The caret's or the button's rect, in viewport coordinates. */
  anchor: Anchor
  /** A Reference path, or a composed call. The caller decides the delimiters. */
  onChoose: (insert: string) => void
  onClose: () => void
}

type TabId = 'reference' | 'function'

export function ExpressionPicker({
  scope,
  expected,
  anchor,
  onChoose,
  onClose,
}: ExpressionPickerProps) {
  const [tab, setTab] = useState<TabId>('reference')
  const [inserting, setInserting] = useState<FunctionSpec | null>(null)

  const place = placement(anchor)

  return (
    <>
      <style href="hatua-expression-picker" precedence="hatua">
        {css}
      </style>
      {/* A click-away backdrop, and deliberately not an interactive element:
          Escape is the keyboard route out, and giving this a role would put a
          stop in the tab order for nothing. */}
      <div className={styles.away} onMouseDown={onClose} aria-hidden="true" />
      <div
        className={styles.panel}
        style={place.style}
        role="dialog"
        aria-label="Insert"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            onClose()
          }
        }}
      >
        <div className={styles.head}>
          {/* The tabs carry the nouns, so a header restating them says it twice. */}
          <p className={styles.title}>Insert</p>
          <div className={styles.tabs} role="tablist" aria-label="What to insert">
            {(['reference', 'function'] as const).map((id) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                className={cx(styles.tab, tab === id && styles.tabOpen)}
                onClick={() => {
                  setTab(id)
                  setInserting(null)
                }}
              >
                {id === 'reference' ? 'Reference' : 'Function'}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.body} style={{ maxHeight: place.maxHeight }}>
          {inserting ? (
            <Inserter
              spec={inserting}
              onBack={() => setInserting(null)}
              onInsert={(text) => onChoose(text)}
            />
          ) : tab === 'reference' ? (
            <ReferenceTab scope={scope} expected={expected} onChoose={onChoose} />
          ) : (
            <FunctionTab expected={expected} onPick={setInserting} />
          )}
        </div>
      </div>
    </>
  )
}

/**
 * Where the panel goes, and how much of it scrolls.
 *
 * `place` answers the first half for every floating layer here. The second is
 * this panel's own: its head and tab strip sit outside the scrolling body, so
 * the body gets the room that is left.
 *
 * The ceiling is generous on purpose. Set close to what the panel usually
 * holds, it turns "the content happens to be a pixel over" into a full-height
 * scrollbar with nothing behind it, which reads as broken rather than as full.
 */
function placement(anchor: Anchor) {
  const at = place(anchor, PANEL)
  return {
    style: { left: at.left, ...(at.top === undefined ? { bottom: at.bottom } : { top: at.top }) },
    maxHeight: Math.max(160, Math.min(560, at.space - HEAD)),
  }
}

/** Matches `.panel`'s `inline-size`; the clamp needs it as a number. */
const PANEL = 392
/** The head, the tab strip and the panel's own padding, none of which scrolls. */
const HEAD = 72

/**
 * Both tabs open with the same control in the same place — a source `<select>`,
 * then a sentence describing the selection, then rows. A Step and a namespace
 * are the same kind of choice.
 *
 * A `<select>` rather than chips because five namespaces fit on one line and
 * thirty Steps do not.
 */
function Source({
  label,
  value,
  options,
  blurb,
  onChange,
}: {
  label: string
  value: string
  options: readonly { value: string; label: string }[]
  blurb: string
  onChange: (next: string) => void
}) {
  return (
    <div className={styles.source}>
      <Select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
      <p className={styles.blurb}>{blurb}</p>
    </div>
  )
}

const ALL = '*'

function ReferenceTab({
  scope,
  expected,
  onChoose,
}: {
  scope: readonly ScopeEntry[]
  expected: ValueType | undefined
  onChoose: (path: string) => void
}) {
  const [source, setSource] = useState(ALL)
  const tree = useMemo(() => referenceTree(scope), [scope])

  const options = [
    { value: ALL, label: 'Everything in scope' },
    ...tree.map((node) => ({ value: node.path, label: node.label })),
  ]

  const shown = source === ALL ? tree : tree.filter((node) => node.path === source)

  if (tree.length === 0) {
    return <p className={styles.empty}>There is nothing to read here yet.</p>
  }

  return (
    <>
      <Source
        label="What to read from"
        value={source}
        options={options}
        blurb={
          source === ALL
            ? 'Everything this field can read, grouped by where it comes from.'
            : (shown[0]?.label ?? '')
        }
        onChange={setSource}
      />
      {shown.map((group) => (
        <section key={group.path} className={styles.group}>
          {/* Group headers only under *Everything*: with one source chosen the
              select above already says which. */}
          {source === ALL ? (
            <h4 className={styles.groupHead}>
              {group.label}
              <code className={styles.groupPath}>{group.path}</code>
            </h4>
          ) : null}
          <Rows nodes={leaves(group)} expected={expected} onChoose={onChoose} />
        </section>
      ))}
    </>
  )
}

/**
 * What a group offers.
 *
 * A grouping prefix — `run`, `triggers`, `var` — is not itself addressable, so
 * it contributes its children and not itself. Everything else contributes its
 * whole subtree, because a Reference may name a branch as readily as a leaf:
 * `{{ steps.s2.messages }}` is the list, and `{{ steps.s2.messages[].subject }}` is a value
 * per element.
 */
const leaves = (group: RefNode): RefNode[] =>
  group.type === 'unknown' && group.children ? flatten(group.children) : flatten([group])

function Rows({
  nodes,
  expected,
  onChoose,
}: {
  nodes: readonly RefNode[]
  expected: ValueType | undefined
  onChoose: (path: string) => void
}) {
  return (
    <ul className={styles.rows}>
      {nodes.map((node) => (
        <li key={node.path}>
          <button
            type="button"
            className={styles.row}
            data-fits={fits(node.type, expected) ? 'true' : undefined}
            draggable
            onDragStart={(event) => {
              for (const [mime, data] of dragPayload(node.path)) {
                event.dataTransfer.setData(mime, data)
              }
              event.dataTransfer.effectAllowed = 'copy'
            }}
            onClick={() => onChoose(node.path)}
          >
            <span className={styles.path}>{node.path}</span>
            <span className={styles.type}>{node.type}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

function FunctionTab({
  expected,
  onPick,
}: {
  expected: ValueType | undefined
  onPick: (spec: FunctionSpec) => void
}) {
  const [source, setSource] = useState(ALL)

  const options = [
    { value: ALL, label: 'All namespaces' },
    ...CORE_NAMESPACES.map((namespace) => ({
      value: namespace.namespace,
      label: namespace.namespace,
    })),
  ]

  const shown: readonly Candidate[] =
    source === ALL
      ? FUNCTION_CANDIDATES
      : FUNCTION_CANDIDATES.filter((candidate) => candidate.spec?.namespace === source)

  return (
    <>
      <Source
        label="Which functions"
        value={source}
        options={options}
        blurb={
          source === ALL
            ? 'Everything that can be called from an expression.'
            : (CORE_NAMESPACES.find((namespace) => namespace.namespace === source)?.summary ?? '')
        }
        onChange={setSource}
      />
      <ul className={styles.rows}>
        {shown.map((candidate) => (
          <li key={candidate.id}>
            <button
              type="button"
              className={styles.row}
              data-fits={fits(candidate.type, expected) ? 'true' : undefined}
              onClick={() => candidate.spec && onPick(candidate.spec)}
            >
              <span className={styles.path}>{candidate.label}</span>
              <span className={styles.type}>{candidate.type}</span>
            </button>
          </li>
        ))}
      </ul>
    </>
  )
}

/**
 * The inserter: one row per parameter, and a live preview of the call.
 *
 * It **inserts and never round-trips.** It composes text and writes it; it
 * never reconstructs itself from text already there. That is what makes it
 * safe: a round-tripping editor needs AST→text, which the grammar does not
 * provide — Peggy gives text→AST — and hand-writing it is a second
 * implementation of the grammar that will disagree with the first (ADR-0008).
 * Reopening it therefore starts fresh, and editing an existing call means
 * editing text, which the input is always typeable through.
 */
function Inserter({
  spec,
  onBack,
  onInsert,
}: {
  spec: FunctionSpec
  onBack: () => void
  onInsert: (text: string) => void
}) {
  const [args, setArgs] = useState<Record<string, string>>({})

  const written = spec.params.map((param) => args[param.name]?.trim() ?? '')
  // Trailing optionals the user left alone are dropped rather than passed as
  // `<name>`: the arity check counts arguments, and an unfilled optional is an
  // argument nobody asked for.
  const supplied = [...written]
  while (
    supplied.length > 0 &&
    supplied.at(-1) === '' &&
    spec.params[supplied.length - 1]?.optional
  ) {
    supplied.pop()
  }

  const call = `${spec.qualified}(${supplied
    .map((value, index) => value || `<${spec.params[index]?.name ?? ''}>`)
    .join(', ')})`

  return (
    <div className={styles.inserter}>
      <div className={styles.inserterHead}>
        <Button size="sm" variant="ghost" onClick={onBack}>
          Back
        </Button>
        <p className={styles.blurb}>{spec.summary}</p>
      </div>

      {spec.params.map((param) => (
        <div key={param.name} className={styles.param}>
          <div className={styles.paramHead}>
            <span className={styles.paramName}>{param.name}</span>
            <span className={styles.type}>{param.type}</span>
            {param.optional ? <span className={styles.optional}>optional</span> : null}
          </div>
          {/* The parameter's own sentence, which is the reason ParamSpec carries
              a description at all. */}
          <p className={styles.paramDoc}>{param.description}</p>
          <Input
            aria-label={param.name}
            value={args[param.name] ?? ''}
            onChange={(event) => setArgs({ ...args, [param.name]: event.target.value })}
          />
        </div>
      ))}

      <p className={styles.preview}>{call}</p>
      <Button size="sm" onClick={() => onInsert(call)}>
        Insert
      </Button>
    </div>
  )
}
