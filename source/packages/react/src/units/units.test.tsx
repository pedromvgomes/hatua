import type { Band, Join, Nest, Rect } from '@hatua/layout'
import { LAYOUT } from '@hatua/layout'
import type { Manifest, Step } from '@hatua/schema'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { boxOf } from './box'
import { JoinMarker } from './JoinMarker'
import { NodeCard } from './NodeCard'
import { RegionBand } from './RegionBand'
import { RegionNest } from './RegionNest'
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
const FETCH: Manifest = {
  kind: 'component',
  use: 'component.email.fetch',
  name: 'Fetch mail',
  fields: [{ k: 'query', label: 'Query', kind: 'text' }],
  outputs: [],
}

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

  it('shows the verb under the name, on every card', () => {
    render(<NodeCard step={leaf} rect={rect} />)
    expect(screen.getByText('component.email.fetch')).toBeDefined()
  })

  /*
   * The meta row is the Step's filled Slots, and only a manifest says which
   * keys are Slots. That is one rule for a leaf and a container alike, and it
   * is the same predicate `heightOf` asks — so a card cannot be the short one
   * with a row in it.
   */
  it('shows a filled Slot as a chip', () => {
    render(
      <NodeCard step={{ ...leaf, with: { query: 'is:unread' } }} rect={rect} manifest={FETCH} />,
    )
    expect(screen.getByText('is:unread')).toBeDefined()
  })

  it('shows a bare Reference as the path it names, not as braces', () => {
    // The braces are syntax, and a card is not where anyone edits it.
    render(
      <NodeCard
        step={{ ...leaf, with: { query: '{{ steps.s0.subject }}' } }}
        rect={rect}
        manifest={FETCH}
      />,
    )
    expect(screen.getByText('steps.s0.subject')).toBeDefined()
    expect(screen.queryByText(/\{\{/)).toBeNull()
  })

  it('gives a container with no declared fields no row at all', () => {
    // A Fork declares `fields: []`, so it has nothing to say below its name —
    // which is why it is the short card even though it nests two Branches.
    const fork: Step = {
      id: 'f',
      use: 'core.fork',
      with: { mode: 'condition' },
      branches: [{ label: 'A', steps: [] }],
    }
    render(
      <NodeCard step={fork} rect={rect} manifest={{ ...FETCH, use: 'core.fork', fields: [] }} />,
    )
    expect(screen.queryByText('condition')).toBeNull()
  })

  it('shows no row before a catalogue arrives, whatever the Step holds', () => {
    render(<NodeCard step={{ ...leaf, with: { query: 'is:unread' } }} rect={rect} />)
    expect(screen.queryByText('is:unread')).toBeNull()
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
    always: false,
    collapsed: false,
    x: 8,
    y: 90,
    width: 300,
    height: 60,
  }

  it('is the one thing saying the word over its own region', () => {
    // Two things saying one word over one region is the duplication this repo
    // refuses everywhere else, so the legend is the Band's and there is no pill
    // floating on the line as well.
    render(<RegionBand band={band} />)
    expect(screen.getByRole('button').textContent).toContain('on failure')
  })

  it('carries a Branch’s own label and its condition beside the keyword', () => {
    render(
      <RegionBand
        band={{ ...band, kind: 'branch', keyword: 'if', branchIndex: 0 }}
        label="Has new mail"
        when="{{ steps.fetch.count }} > 0"
      />,
    )
    expect(screen.getByRole('button').textContent).toContain(
      'ifHas new mail{{ steps.fetch.count }} > 0',
    )
  })

  it('is a frame with room in it where the region is empty', () => {
    const { container } = render(<RegionBand band={{ ...band, height: LAYOUT.emptyRegion }} />)
    const box = container.querySelector('div') as HTMLElement
    expect(box.style.height).toBe(`${LAYOUT.emptyRegion}px`)
    expect(box.style.top).toBe('90px')
  })

  it('makes the word the control that folds its own column', () => {
    // The one mark on screen naming this region and nothing else. A separate
    // control would be a second mark over one region.
    const folds: number[] = []
    render(<RegionBand band={band} onToggle={() => folds.push(1)} />)
    const legend = screen.getByRole('button')

    expect(legend.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(legend)
    expect(folds).toHaveLength(1)
  })

  it('says how many Steps a folded column is holding back', () => {
    // A folded box and an empty one are the same rect and mean opposite things:
    // one is somewhere to add a Step, the other is Steps out of sight.
    const { container } = render(
      <RegionBand band={{ ...band, collapsed: true, height: LAYOUT.emptyRegion }} count={3} />,
    )

    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('false')
    expect(container.textContent).toContain('3 steps')
  })

  it('draws a dashed edge only when the canvas says so, never off its own kind', () => {
    // Whether a column has a solid sibling to be read against is a question
    // about the Step's OTHER regions, which a Band cannot see (ADR-0015).
    const branch = { ...band, kind: 'branch' as const, keyword: 'if', branchIndex: 0 }
    const box = (node: HTMLElement) => node.querySelector('div') as HTMLElement

    expect(box(render(<RegionBand band={branch} />).container).className).not.toContain('dashed')
    expect(box(render(<RegionBand band={branch} dashed />).container).className).toContain('dashed')
  })
})

describe('RegionNest', () => {
  const nest: Nest = {
    owner: { board: null, id: 's2' },
    x: 4,
    y: 40,
    width: 320,
    height: 200,
  }

  it('names nothing, because the Bands inside it do', () => {
    // A word here would be a second thing saying what the container is, beside
    // the card that already says it.
    const { container } = render(<RegionNest nest={nest} />)
    expect(container.textContent).toBe('')
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull()
  })

  it('goes exactly where the geometry says, and works nothing out for itself', () => {
    const { container } = render(<RegionNest nest={nest} />)
    const box = container.querySelector('div') as HTMLElement
    expect(box.style.top).toBe('40px')
    expect(box.style.left).toBe('4px')
    expect(box.style.height).toBe('200px')
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
    expect(screen.getByText('The regions of How urgent? come back together')).toBeDefined()
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
