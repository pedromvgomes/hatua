import type { ValueType } from '@hatua/expressions'
import type { ScopeEntry } from '@hatua/model'
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { Select } from '../primitives/Select'
import { flatten, type RefNode, referenceTree } from './candidates'
import { dragPayload, fits } from './insertion'
import styles from './ReferenceTree.module.css'
import css from './ReferenceTree.module.css?inline'

/**
 * The scope as browsable rows: a source `<select>`, then one group per root,
 * then a row per addressable value.
 *
 * **One component, two mounts.** The picker's *Reference* tab is a popover over
 * a field, and `<Data>` is a column standing open beside the step editor —
 * different places, the same question, and a second implementation of it would
 * be a second answer about what is readable and what a row's rail means. What
 * differs between the two is expressed as props: the panel marks what is
 * already read and reports what is hovered, the popover neither.
 *
 * Every row is composed from a `ScopeEntry.path` and never pattern-matched out
 * of text. `@hatua/expressions` owns what a Reference is, and a regex here
 * would be a second definition of it that eventually disagrees.
 */
export interface ReferenceTreeProps {
  scope: readonly ScopeEntry[]
  /** What an insertion here has to produce, or undefined where nothing declares one. */
  expected?: ValueType
  /**
   * Paths the thing being edited already reads.
   *
   * Marked rather than hidden or reordered: a run of mappings is easier to
   * finish when the rows stay where they were and say which are done.
   */
  referenced?: ReadonlySet<string>
  /** What to say when nothing is in scope. The two mounts sit in different places. */
  empty?: ReactNode
  /**
   * A row was chosen — clicked, or Enter from the keyboard.
   *
   * Required, because every row is a `<button>`: a control that is live and
   * does nothing reads as a fault, which is the argument `CanvasControls`
   * already makes about greying out the ends of the zoom range. The popover
   * inserts the path; the panel, which edits nothing, copies the token.
   */
  onChoose: (path: string) => void
  /** A row was pointed at or focused; `null` when it was left. */
  onHighlight?: (path: string | null) => void
}

const ALL = '*'

export function ReferenceTree({
  scope,
  expected,
  referenced,
  empty,
  onChoose,
  onHighlight,
}: ReferenceTreeProps) {
  const [source, setSource] = useState(ALL)
  const tree = useMemo(() => referenceTree(scope), [scope])

  const options = [
    { value: ALL, label: 'Everything in scope' },
    ...tree.map((node) => ({ value: node.path, label: node.label })),
  ]

  // A source chosen and then gone — the Step the rows came from was removed, or
  // the selection moved to a Board that declares no variables. Falling back to
  // everything rather than showing an empty list under a `<select>` naming a
  // group that is not in it.
  const chosen = tree.some((node) => node.path === source) ? source : ALL
  const shown = chosen === ALL ? tree : tree.filter((node) => node.path === chosen)

  return (
    <>
      <style href="hatua-reference-tree" precedence="hatua">
        {css}
      </style>
      {tree.length === 0 ? (
        <p className={styles.empty}>{empty ?? 'There is nothing to read here yet.'}</p>
      ) : (
        <>
          <Source
            label="What to read from"
            value={chosen}
            options={options}
            blurb={
              chosen === ALL
                ? 'Everything in scope, grouped by where it comes from.'
                : (shown[0]?.label ?? '')
            }
            onChange={setSource}
          />

          {shown.map((group) => (
            <section key={group.path} className={styles.group}>
              {/* Group headers only under *Everything*: with one source chosen
                  the select above already says which. */}
              {chosen === ALL ? (
                <h4 className={styles.groupHead}>
                  {group.label}
                  <code className={styles.groupPath}>{group.path}</code>
                </h4>
              ) : null}
              <Rows
                nodes={leaves(group)}
                expected={expected}
                referenced={referenced}
                onChoose={onChoose}
                onHighlight={onHighlight}
              />
            </section>
          ))}
        </>
      )}
    </>
  )
}

/**
 * What a group offers.
 *
 * A grouping prefix — `run`, `triggers`, `var` — is not itself addressable, so
 * it contributes its children and not itself. Everything else contributes its
 * whole subtree, because a Reference may name a branch as readily as a leaf:
 * `{{ steps.s2.messages }}` is the list, and `{{ steps.s2.messages[].subject }}`
 * is a value per element.
 */
const leaves = (group: RefNode): RefNode[] =>
  group.type === 'unknown' && group.children ? flatten(group.children) : flatten([group])

function Rows({
  nodes,
  expected,
  referenced,
  onChoose,
  onHighlight,
}: {
  nodes: readonly RefNode[]
  expected: ValueType | undefined
  referenced: ReadonlySet<string> | undefined
  onChoose: (path: string) => void
  onHighlight?: (path: string | null) => void
}) {
  return (
    <ul className={styles.rows}>
      {nodes.map((node) => (
        <Row
          key={node.path}
          node={node}
          expected={expected}
          referenced={referenced?.has(node.path) ?? false}
          onChoose={onChoose}
          onHighlight={onHighlight}
        />
      ))}
    </ul>
  )
}

/**
 * The control both this and the picker's *Function* tab open with — a source
 * `<select>`, then a sentence describing the selection, then rows. A Step and a
 * namespace are the same kind of choice.
 *
 * A `<select>` rather than chips because five namespaces fit on one line and
 * thirty Steps do not.
 */
export function Source({
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

function Row({
  node,
  expected,
  referenced,
  onChoose,
  onHighlight,
}: {
  node: RefNode
  expected: ValueType | undefined
  referenced: boolean
  onChoose: (path: string) => void
  onHighlight?: (path: string | null) => void
}) {
  const pointed = useRef(false)

  /*
   * Say the row was left when React removes it.
   *
   * `onMouseLeave` and `onBlur` do not fire for a node that unmounts, and this
   * list is rebuilt whenever scope changes — an undo that removes the Step a
   * leaf came from, or another region's edit. Without this the step editor goes
   * on marking fields for a leaf that is no longer on screen until the user
   * happens to point at another one.
   *
   * Through a ref rather than a dependency, so a caller passing a fresh
   * function each render does not make this fire while the row is still
   * pointed at.
   */
  const report = useRef(onHighlight)
  report.current = onHighlight
  useEffect(
    () => () => {
      if (pointed.current) report.current?.(null)
    },
    [],
  )

  const enter = () => {
    pointed.current = true
    onHighlight?.(node.path)
  }
  const leave = () => {
    pointed.current = false
    onHighlight?.(null)
  }

  return (
    <li>
      <button
        type="button"
        className={styles.row}
        data-fits={fits(node.type, expected) ? 'true' : undefined}
        data-referenced={referenced ? 'true' : undefined}
        draggable
        onDragStart={(event) => {
          for (const [mime, data] of dragPayload(node.path)) {
            event.dataTransfer.setData(mime, data)
          }
          event.dataTransfer.effectAllowed = 'copy'
        }}
        // Focus as well as hover, because drag has no keyboard equivalent and
        // the highlight is the only thing tying a row to the fields that read
        // it.
        onMouseEnter={enter}
        onMouseLeave={leave}
        onFocus={enter}
        onBlur={leave}
        onClick={() => onChoose(node.path)}
      >
        <span className={styles.path}>{node.path}</span>
        {referenced ? <span className={styles.used}>used</span> : null}
        <span className={styles.type}>{node.type}</span>
      </button>
    </li>
  )
}
