import type { Rect } from '@hatua/layout'
import { boxOf } from './box'
import styles from './RootNode.module.css'
import css from './RootNode.module.css?inline'

export interface RootNodeProps {
  rect: Rect
  /** What starts this Board: `Triggers` at the root, the Block's name inside one. */
  title: string
  /** The contract in a line — how many Triggers, or how many params and outputs. */
  summary: string
}

/**
 * The node above the first Step: the Triggers on the root Board, the Block's
 * contract inside one.
 *
 * A unit of its own rather than a `<NodeCard>` variant, for the same reason
 * `FlowMap.root` is a `Rect` and not a `Placement`: **it names no Step.** It is
 * chrome derived from `triggers:` or from a Block's declaration rather than a
 * `steps[]` entry, which is what keeps `removeStep`, `walkSteps` and
 * `unknownComponents` from needing a case for it. A `<NodeCard>` taking an
 * optional Step would push "sometimes there is no Step here" into the one
 * component every card on the map goes through, to spare a file.
 *
 * It is not a button. Nothing selects it yet — the step editor is where a
 * Trigger's fields would be edited and that region is still a stub — and a
 * control that highlights itself and opens nothing is worse than no control.
 */
export function RootNode({ rect, title, summary }: RootNodeProps) {
  return (
    <>
      <style href="hatua-root-node" precedence="hatua">
        {css}
      </style>
      <div className={styles.root} style={boxOf(rect)}>
        <span className={styles.title}>{title}</span>
        <span className={styles.summary}>{summary}</span>
      </div>
    </>
  )
}
