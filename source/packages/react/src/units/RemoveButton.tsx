import styles from './RemoveButton.module.css'
import css from './RemoveButton.module.css?inline'

export interface RemoveButtonProps {
  /**
   * What this removes, said in full: an icon button's `aria-label` is its only
   * name, and four bins on one panel all called "Remove" name nothing.
   */
  label: string
  onClick: () => void
}

/**
 * The bin that removes a row.
 *
 * A bin, not a cross. `×` is the glyph for dismissing a thing — closing a panel,
 * clearing a filter — and this takes something out of the document. Drawn rather
 * than set in type: the only bin in a text font is an emoji, which renders at a
 * size and a colour the row it sits in does not control.
 *
 * One definition because every surface that lists rows out of the document has
 * one — the Workflow tab's Triggers, contract and variables, and the catalogue's
 * Blocks. A second copy is a second hit area, a second hover colour and a second
 * answer to how the icon is drawn.
 */
export function RemoveButton({ label, onClick }: RemoveButtonProps) {
  return (
    <>
      <style href="hatua-remove-button" precedence="hatua">
        {css}
      </style>
      <button type="button" className={styles.remove} aria-label={label} onClick={onClick}>
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
    </>
  )
}
