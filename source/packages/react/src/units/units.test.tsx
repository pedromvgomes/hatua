import type { Band, Join, Rect } from '@hatua/layout'
import { LAYOUT } from '@hatua/layout'
import type { Step } from '@hatua/schema'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { boxOf } from './box'
import { JoinMarker } from './JoinMarker'
import { NodeCard } from './NodeCard'
import { RegionBand } from './RegionBand'
import { RootNode } from './RootNode'

/**
 * The presentational units the canvas is drawn from: props in, events out.
 *
 * None of them reaches `@hatua/services` and none of them works out where it
 * goes — every box comes from a `Rect`, a `Band` or a `Join` that
 * `@hatua/layout` computed. That is the tier's whole rule, and the reason these
 * are testable without a store, a document or a provider above them.
 */

const rect: Rect = { x: 40, y: 12, width: LAYOUT.nodeWidth, height: LAYOUT.nodeHeight }

const leaf: Step = { id: 's1', use: 'component.email.fetch', name: 'Fetch mail', with: {} }
const container: Step = {
  id: 's2',
  use: 'core.try',
  name: 'Publish',
  with: {},
  steps: [leaf],
  handler: [],
}

describe('boxOf', () => {
  it('puts a box exactly where the Rect says', () => {
    expect(boxOf(rect)).toEqual({
      position: 'absolute',
      left: 40,
      top: 12,
      width: LAYOUT.nodeWidth,
      height: LAYOUT.nodeHeight,
    })
  })

  it('is physical, so an RTL Host does not draw the map backwards', () => {
    // Logical properties would mirror the whole canvas while the numbers behind
    // it stayed the same, so a Fork's first Branch would be drawn last.
    const style = boxOf(rect) as Record<string, unknown>
    expect(style.insetInlineStart).toBeUndefined()
    expect(style.left).toBe(40)
  })
})

describe('NodeCard', () => {
  it('names the Step and reports a click, without deciding what selection means', () => {
    const onSelect = vi.fn()
    render(<NodeCard step={leaf} rect={rect} onSelect={onSelect} />)

    fireEvent.click(screen.getByText('Fetch mail'))
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('falls back to the id, which is what a Step always has', () => {
    render(<NodeCard step={{ id: 'lonely', use: 'core.end' }} rect={rect} />)
    expect(screen.getByText('lonely')).toBeDefined()
  })

  /*
   * `heightOf` returns the taller card exactly when `isContainer`, so the
   * summary row appears on exactly those cards. Asked of the same predicate
   * rather than of "is there a summary": `summaryOf` always returns something,
   * and a leaf showing it would be 100px of content in a 64px box.
   */
  it('carries the summary on a container and nothing but a name on a leaf', () => {
    const { unmount } = render(<NodeCard step={container} rect={rect} />)
    expect(screen.getByText('core.try · 1 step · handler')).toBeDefined()
    unmount()

    render(<NodeCard step={leaf} rect={rect} />)
    expect(screen.queryByText('component.email.fetch')).toBeNull()
  })

  it('offers a chevron on a container and none on a leaf', () => {
    const onToggle = vi.fn()
    const { unmount } = render(
      <NodeCard step={container} rect={rect} expanded={false} onToggle={onToggle} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Expand Publish' }))
    expect(onToggle).toHaveBeenCalledTimes(1)
    unmount()

    render(<NodeCard step={leaf} rect={rect} />)
    expect(screen.queryByRole('button', { name: /Collapse|Expand/ })).toBeNull()
  })

  it('offers a doorway only where the caller says there is one', () => {
    // A call is a doorway into another Board (ADR-0013), and which Boards exist
    // is the document's — this unit is handed a Step and has nothing to look a
    // `block.<slug>` up in.
    const onOpen = vi.fn()
    const { unmount } = render(<NodeCard step={leaf} rect={rect} opens="alpha" onOpen={onOpen} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open Fetch mail' }))
    expect(onOpen).toHaveBeenCalledTimes(1)
    unmount()

    render(<NodeCard step={leaf} rect={rect} />)
    expect(screen.queryByRole('button', { name: /^Open / })).toBeNull()
  })

  it('says what is wrong in words, not in colour alone', () => {
    render(
      <NodeCard
        step={leaf}
        rect={rect}
        problems={[{ code: 'FIELD_REQUIRED', blocks: 'publish', message: 'Fill in "to".' }]}
      />,
    )
    expect(screen.getByRole('status').textContent).toBe('Fetch mail: 1 problem. Fill in "to".')
  })
})

describe('RegionBand', () => {
  const band: Band = {
    kind: 'handler',
    keyword: 'on failure',
    owner: { board: null, id: 's2' },
    x: 8,
    y: 90,
    width: 300,
    height: LAYOUT.regionLabel + 60,
  }

  it('says the word the band carries and never works one out', () => {
    render(<RegionBand band={band} />)
    expect(screen.getByText('on failure')).toBeDefined()
  })

  it('shows a Branch’s own label and condition beside the keyword', () => {
    // Two different things: the keyword comes from the fork's shape and the
    // label is free text a user renames.
    render(
      <RegionBand
        band={{ ...band, kind: 'branch', keyword: 'else if' }}
        label="Quiet"
        when="{{ var.quiet }}"
      />,
    )
    expect(screen.getByText('else if')).toBeDefined()
    expect(screen.getByText('Quiet')).toBeDefined()
    expect(screen.getByText('{{ var.quiet }}')).toBeDefined()
  })

  it('takes the label strip’s height from LAYOUT rather than from a copy of the number', () => {
    // The layout reserves exactly `regionLabel` at the top of the band and lays
    // the cards out below it. A matching number in the stylesheet is a second
    // copy that drifts the day the first one moves.
    render(<RegionBand band={band} />)
    expect((screen.getByText('on failure').parentElement as HTMLElement).style.blockSize).toBe(
      `${LAYOUT.regionLabel}px`,
    )
  })

  it('is the whole region, so an empty one is still a box with a word over it', () => {
    const { container } = render(<RegionBand band={{ ...band, height: LAYOUT.regionLabel }} />)
    const box = container.querySelector('div') as HTMLElement
    expect(box.style.height).toBe(`${LAYOUT.regionLabel}px`)
    expect(box.style.top).toBe('90px')
  })
})

describe('JoinMarker', () => {
  const join: Join = {
    owner: { board: null, id: 'sort' },
    x: 0,
    y: 300,
    width: 480,
    height: LAYOUT.joinMarker,
  }

  it('says what converges, for everyone a rule on screen says nothing to', () => {
    render(<JoinMarker join={join} name="How urgent?" />)
    expect(screen.getByText('The branches of How urgent? come back together')).toBeDefined()
  })
})

describe('RootNode', () => {
  it('names the Board’s contract and is not a control', () => {
    // It names no Step — which is why `FlowMap.root` is a `Rect` and not a
    // `Placement` — and nothing selects it, so it offers nothing to click.
    const { container } = render(<RootNode rect={rect} title="Triggers" summary="2 triggers" />)
    expect(screen.getByText('Triggers')).toBeDefined()
    expect(screen.getByText('2 triggers')).toBeDefined()
    expect(container.querySelector('button')).toBeNull()
  })
})
