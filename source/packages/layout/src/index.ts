/**
 * Derived layout: step tree in, flow-map geometry out.
 *
 * Positions are computed on every render and never stored (ADR-0001) — the map
 * is a reading of the tree, so a hand-edited Workflow Definition cannot
 * disagree with it. Constants come from the design handoff.
 */

export const LAYOUT = {
  nodeWidth: 236,
  nodeHeight: 64,
  /** Node height when the card shows a meta row. */
  nodeHeightWithMeta: 100,
  verticalGap: 96,
  /** Horizontal gap between branch columns. */
  branchGap: 44,
  joinMarker: 26,
} as const

export interface Placement {
  stepId: string
  x: number
  y: number
  width: number
  height: number
}

export interface FlowMap {
  placements: Placement[]
  width: number
  height: number
}
