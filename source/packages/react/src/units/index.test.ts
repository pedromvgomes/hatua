import { describe, expect, it } from 'vitest'
import { boxOf } from './box'
import * as units from './index'
import { NodeCard } from './NodeCard'
import { SegmentBar } from './SegmentBar'

/**
 * The tier's own barrel, asserted as a set.
 *
 * A barrel is the one file where a mistake is invisible: every unit is also
 * reachable by its own path, so dropping a re-export still compiles everywhere.
 * Nothing in the package imports through this one, which is exactly why it needs
 * a test of its own.
 */
describe('the units barrel', () => {
  it('exports every unit the canvas is drawn from', () => {
    expect(Object.keys(units).sort()).toEqual([
      'BoardTabs',
      'CanvasControls',
      'Connectors',
      'IconCoin',
      'InsertDot',
      'JoinMarker',
      'NodeCard',
      'RegionBand',
      'RegionNest',
      'RemoveButton',
      'RootNode',
      'SegmentBar',
      'boxOf',
    ])
  })

  it('re-exports the modules themselves, so a name cannot resolve to another unit', () => {
    // Two units with the same shape of props swap silently, and a card drawn
    // where a root node belongs is a rendering difference nothing type-checks.
    expect(units.NodeCard).toBe(NodeCard)
    expect(units.SegmentBar).toBe(SegmentBar)
    expect(units.boxOf).toBe(boxOf)
  })
})
