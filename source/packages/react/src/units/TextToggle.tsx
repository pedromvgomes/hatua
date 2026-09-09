import { cx } from '../primitives/classNames'
import styles from './TextToggle.module.css'
import css from './TextToggle.module.css?inline'

/**
 * Swaps the column between the two ways of editing one **Workflow Definition**:
 * **Canvas Mode** and **Text Mode**.
 *
 * ## Why it is here and not in the toolbar
 *
 * ADR-0001 opens with "a user edits one Workflow Definition two ways —
 * graphically on the flow map, and as raw YAML text", and CONTEXT.md defines
 * both as editing *the same document*. So this is a choice about how a document
 * is drawn, and **Runs** is a choice about which document — two different
 * questions, and one control carrying both said they were the same kind of
 * thing. The bar keeps `Build | Runs`; how the column draws what is on screen
 * belongs to the column.
 *
 * That placement is also what makes "the document does not change" obvious
 * rather than a rule to remember: the control is inside the thing showing it.
 *
 * ## One button, not two segments
 *
 * One label in both states, with `aria-pressed` saying which one it is in —
 * exactly the call the **References** control on the Data panel makes, for the
 * reason stated there: a control that swaps its verb *and* reports pressed
 * announces the state twice.
 *
 * ## Why it reads YAML
 *
 * Naming the format rather than the idea. *Text* is ambiguous on a canvas, where
 * it reads as "add a text box" before it reads as "show me the file"; *Source* is
 * short for source code and is on **Text Mode**'s avoid list in CONTEXT.md, for
 * the reason `attempt` beat `try` — every one of these words renders inside
 * somebody else's product, to people who have never written code. YAML is what
 * is behind the button.
 *
 * The concept is still **Text Mode**, and the two are allowed to differ: `Data`
 * announces itself as *References* for the same reason. What may NOT differ is
 * this label and the landmark it opens, so the region answers to YAML too.
 */
export interface TextToggleProps {
  /** Whether the column is showing the text. */
  pressed: boolean
  onToggle: () => void
  className?: string
}

export function TextToggle({ pressed, onToggle, className }: TextToggleProps) {
  return (
    <>
      <style href="hatua-text-toggle" precedence="hatua">
        {css}
      </style>
      <button
        type="button"
        className={cx(styles.toggle, className)}
        aria-pressed={pressed}
        onClick={onToggle}
      >
        YAML
      </button>
    </>
  )
}
