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
 * ## The label is where it goes, not where you are
 *
 * `YAML` while the flow is drawn, `Flow` while the YAML is. Two peers, and a
 * button that names its destination is the plainest thing to press.
 *
 * So no `aria-pressed`: a control that swaps its verb *and* reports pressed
 * announces the state twice, which is the argument the **References** control
 * makes — and that control keeps one label precisely because it opens and closes
 * one panel rather than swapping between two equals.
 *
 * It reads YAML rather than *Text* or *Source*. Text is ambiguous on a canvas,
 * where it reads as "add a text box" before it reads as "show me the file";
 * Source is
 * short for source code and is on **Text Mode**'s avoid list in CONTEXT.md, for
 * the reason `attempt` beat `try` — every one of these words renders inside
 * somebody else's product, to people who have never written code.
 *
 * The concept is still **Text Mode**, and a rendered label may differ from a
 * domain term: `Data` announces itself as *References* for the same reason. What
 * may not differ is this label and the landmark it opens, so the region answers
 * to YAML too.
 *
 * ## One control, two shells
 *
 * Drawn as the head of the zoom strip — `YAML | − 100% + ⛶` — because a control
 * sharing that corner reads as chrome where one floating alone reads as
 * something left behind. In **Text Mode** there is no strip, because there is no
 * canvas to zoom, so it brings a shell of its own that matches. Which of the two
 * it is follows from what is on screen and is never asked for separately: when
 * the flow is showing there is a strip to sit in, and when it is not there is
 * not.
 */
export interface TextToggleProps {
  /** What the column is drawing now. The button offers the other one. */
  showing: 'flow' | 'yaml'
  onToggle: () => void
  className?: string
}

export function TextToggle({ showing, onToggle, className }: TextToggleProps) {
  const button = (
    <button type="button" className={styles.toggle} onClick={onToggle}>
      {showing === 'flow' ? 'YAML' : 'Flow'}
    </button>
  )

  return (
    <>
      <style href="hatua-text-toggle" precedence="hatua">
        {css}
      </style>
      {showing === 'flow' ? (
        button
      ) : (
        // Its own shell, shaped like the strip it is standing in for, so the one
        // control looks like one control wherever the column has put it.
        <div className={cx(styles.shell, className)}>{button}</div>
      )}
    </>
  )
}
