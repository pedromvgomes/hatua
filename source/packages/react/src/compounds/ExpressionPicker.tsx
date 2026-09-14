import type { FunctionSpec, ValueType } from '@hatua/expressions'
import { CORE_NAMESPACES } from '@hatua/expressions'
import type { ScopeEntry } from '@hatua/model'
import { useState } from 'react'
import { Button } from '../primitives/Button'
import { cx } from '../primitives/classNames'
import { Input } from '../primitives/Input'
import { type Anchor, place } from '../primitives/placement'
import { type Candidate, FUNCTION_CANDIDATES } from './candidates'
import styles from './ExpressionPicker.module.css'
import css from './ExpressionPicker.module.css?inline'
import { fits } from './insertion'
import { ReferenceTree, Source } from './ReferenceTree'
import rowStyles from './ReferenceTree.module.css'
/*
 * The row and source styles both tabs draw, defined once beside the component
 * that owns them. The *Function* tab reaches for them because a function and a
 * value are the same kind of choice on screen — a second copy here would be two
 * answers to what a row looks like, and they would drift the first time one is
 * touched.
 */
import rowCss from './ReferenceTree.module.css?inline'

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
      {/* The Function tab draws <ReferenceTree>'s rows without mounting it, so
          the panel brings that stylesheet with it. React 19 dedupes by href,
          so mounting the tree as well paints nothing twice. */}
      <style href="hatua-reference-tree" precedence="hatua">
        {rowCss}
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
            <ReferenceTree
              scope={scope}
              expected={expected}
              empty="There is nothing to read here yet."
              onChoose={onChoose}
            />
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

const ALL = '*'

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
      <ul className={rowStyles.rows}>
        {shown.map((candidate) => (
          <li key={candidate.id}>
            <button
              type="button"
              className={rowStyles.row}
              data-fits={fits(candidate.type, expected) ? 'true' : undefined}
              onClick={() => candidate.spec && onPick(candidate.spec)}
            >
              <span className={rowStyles.path}>{candidate.label}</span>
              <span className={rowStyles.type}>{candidate.type}</span>
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
    <div>
      <div className={styles.inserterHead}>
        <Button size="sm" variant="ghost" onClick={onBack}>
          Back
        </Button>
        <p className={rowStyles.blurb}>{spec.summary}</p>
      </div>

      {spec.params.map((param) => (
        <div key={param.name} className={styles.param}>
          <div className={styles.paramHead}>
            <span className={styles.paramName}>{param.name}</span>
            <span className={rowStyles.type}>{param.type}</span>
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
