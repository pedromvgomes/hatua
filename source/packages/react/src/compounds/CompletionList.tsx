import type { ValueType } from '@hatua/expressions'
import { cx } from '../primitives/classNames'
import styles from './CompletionList.module.css'
import css from './CompletionList.module.css?inline'
import type { Candidate } from './candidates'
import { fits } from './insertion'

/**
 * The caret-anchored list: 30px rows, the typed prefix accented, the type at
 * the right, and a docstring strip under it.
 *
 * A `listbox` rather than a menu, and it never takes focus — the input keeps it
 * and owns `aria-activedescendant`, which is the whole reason the input can be
 * a `combobox` at all. Ghost text and `Tab` alone are invisible to a screen
 * reader; this is what is not.
 */
export interface CompletionListProps {
  id: string
  candidates: readonly Candidate[]
  /** Index into `candidates`; the input moves it with the arrow keys. */
  active: number
  /** How many leading characters of each label the user has typed. */
  matched: number
  /** What the insertion has to produce, or undefined where nothing declares one. */
  expected: ValueType | undefined
  onPick: (candidate: Candidate) => void
  onActive: (index: number) => void
  /** Where to put it, measured from the field's top-left. */
  at: { left: number; top: number }
}

export const rowId = (listId: string, index: number) => `${listId}-row-${index}`

export function CompletionList({
  id,
  candidates,
  active,
  matched,
  expected,
  onPick,
  onActive,
  at,
}: CompletionListProps) {
  const focused = candidates[active]

  return (
    <>
      <style href="hatua-completion" precedence="hatua">
        {css}
      </style>
      <div className={styles.panel} style={{ left: at.left, top: at.top }}>
        {/*
          Divs carrying the roles, not a <ul>/<li>: the list never takes focus —
          the input keeps it and points at the active row through
          `aria-activedescendant`, which is what makes the input a combobox at
          all — and a list of options that is not a list of links or buttons is
          exactly what those roles are for.
        */}
        <div className={styles.list} id={id} role="listbox" aria-label="Suggestions" tabIndex={-1}>
          {candidates.map((candidate, index) => (
            <div
              key={candidate.id}
              id={rowId(id, index)}
              role="option"
              tabIndex={-1}
              aria-selected={index === active}
              className={cx(styles.row, index === active && styles.active)}
              // The rail is a pseudo-element with its own geometry rather than a
              // dot: a dot encoded "this is a list", which the type column at
              // the right already says in words.
              data-fits={fits(candidate.type, expected) ? 'true' : undefined}
              // Mouse down, not click: the input must not lose focus before the
              // row is taken, or the caret position the insertion needs is gone.
              onMouseDown={(event) => {
                event.preventDefault()
                onPick(candidate)
              }}
              onMouseEnter={() => onActive(index)}
            >
              <span className={styles.label}>
                <span className={styles.typed}>{candidate.label.slice(0, matched)}</span>
                {candidate.label.slice(matched)}
              </span>
              <span className={styles.type}>{candidate.type ?? ''}</span>
            </div>
          ))}
        </div>

        {/* Mounted whether or not the focused row has a sentence, so the list
            does not jump by 20px as the selection moves down it. */}
        <p className={cx(styles.doc, !focused?.summary && styles.silent)}>
          {focused?.summary ?? ''}
        </p>
      </div>
    </>
  )
}
