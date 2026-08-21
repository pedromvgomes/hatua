import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Components } from './Components'
import { Data } from './Data'
import { FlowMap } from './FlowMap'
import { Inspector } from './Inspector'
import { StepList } from './StepList'
import { TabbedPanel } from './TabbedPanel'
import { TopBar } from './TopBar'
import { Workflow } from './Workflow'

/**
 * Every region, mounted alone — outside <Build>, outside <Hatua>, outside the
 * tab strip.
 *
 * This is the test that keeps the promise. A region that reached for a context
 * only <Build> provides would still work everywhere the app renders it, and the
 * first Host to mount one by itself would be the one to find out. So each is
 * rendered bare here, and the failure mode is a broken test rather than a
 * broken embedding.
 */
const REGIONS = [
  { name: 'TopBar', element: <TopBar />, role: 'region', label: 'Toolbar', href: 'hatua-topbar' },
  {
    // "Components", not "Library": the label a user reads and the region a Host
    // imports are the same word, which is the whole point of the rename.
    name: 'Components',
    element: <Components />,
    role: 'region',
    label: 'Components',
    href: 'hatua-components',
  },
  {
    name: 'Workflow',
    element: <Workflow />,
    role: 'region',
    label: 'Workflow',
    href: 'hatua-workflow',
  },
  {
    name: 'StepList',
    element: <StepList />,
    role: 'region',
    label: 'Steps',
    href: 'hatua-step-list',
  },
  {
    // "Flow map", not "Flow": the tab labelled Flow is <StepList>, and two
    // landmarks answering to one name is how the canvas ended up mounted as a
    // tab with nowhere on the screen of its own.
    name: 'FlowMap',
    element: <FlowMap />,
    role: 'region',
    label: 'Flow map',
    href: 'hatua-flow-map',
  },
  { name: 'Data', element: <Data />, role: 'region', label: 'Data', href: 'hatua-data' },
  {
    name: 'Inspector',
    element: <Inspector />,
    role: 'complementary',
    label: 'Inspector',
    href: 'hatua-inspector',
  },
] as const

describe.each(REGIONS)('$name', ({ element, role, label, href }) => {
  it('mounts alone, with no container above it', () => {
    const { container } = render(element)
    expect(container.firstElementChild).not.toBeNull()
    expect(container.textContent?.trim()).not.toBe('')
  })

  it('names itself, so a Host composing regions gets a landmark it can label', () => {
    render(element)
    expect(screen.getByRole(role, label ? { name: label } : {})).toBeDefined()
  })

  it('claims no page-level landmark, because Hatua is the guest', () => {
    // A <header> with no sectioning ancestor IS the page banner, and an
    // embedded designer has no business owning one — the Host has its own.
    // Same for <h1>: the workflow's name must not outrank the application.
    render(element)
    expect(screen.queryByRole('banner')).toBeNull()
    expect(screen.queryByRole('main')).toBeNull()
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull()
  })

  it('carries its own stylesheet, so mounting it alone still paints it', () => {
    // React 19 hoists <style href precedence> out of the tree, so the assertion
    // is on the document rather than on the container (ADR-0003). Mounting a
    // region alone has to bring its CSS with it, or "the parts are the seam"
    // means a Host gets an unstyled one.
    render(element)
    expect(
      document.querySelector(`style[href="${href}"], style[data-href="${href}"]`),
    ).not.toBeNull()
  })
})

describe('TabbedPanel', () => {
  const TABS = [
    { id: 'components', label: 'Components', content: <p>components body</p> },
    { id: 'flow', label: 'Flow', content: <p>flow body</p> },
    { id: 'workflow', label: 'Workflow', content: <p>workflow body</p> },
  ]

  it('arranges the regions it is handed and imports none of them', () => {
    render(<TabbedPanel tabs={TABS} />)
    expect(screen.getAllByRole('tab')).toHaveLength(3)
    expect(screen.getByText('components body')).toBeDefined()
  })

  it('opens the first tab, or the one named', () => {
    const { unmount } = render(<TabbedPanel tabs={TABS} />)
    expect(screen.getByRole('tab', { selected: true }).textContent).toBe('Components')
    unmount()

    render(<TabbedPanel tabs={TABS} defaultTabId="workflow" />)
    expect(screen.getByRole('tab', { selected: true }).textContent).toBe('Workflow')
  })

  it('switches on click', () => {
    render(<TabbedPanel tabs={TABS} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Flow' }))
    expect(screen.getByText('flow body')).toBeDefined()
    expect(screen.queryByText('components body')).toBeNull()
  })

  it('moves between tabs with the arrow keys, wrapping at both ends', () => {
    render(<TabbedPanel tabs={TABS} />)
    const tablist = screen.getByRole('tablist')
    fireEvent.keyDown(tablist, { key: 'ArrowRight' })
    expect(screen.getByRole('tab', { selected: true }).textContent).toBe('Flow')
    fireEvent.keyDown(tablist, { key: 'ArrowLeft' })
    fireEvent.keyDown(tablist, { key: 'ArrowLeft' })
    expect(screen.getByRole('tab', { selected: true }).textContent).toBe('Workflow')
  })

  /*
   * Selection without focus desynchronises the roving tabindex: the old button
   * keeps DOM focus while being re-rendered with tabIndex={-1}, so the next
   * Enter fires ITS onClick and the selection snaps straight back. A screen
   * reader announces nothing either, because nothing moved.
   */
  it('takes focus with it, so Enter acts on the tab the arrow opened', () => {
    render(<TabbedPanel tabs={TABS} />)
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' })

    const opened = screen.getByRole('tab', { name: 'Flow' })
    expect(document.activeElement).toBe(opened)

    // Without focus following selection, this click lands on the old tab and
    // snaps the selection straight back.
    fireEvent.click(document.activeElement as HTMLElement)
    expect(screen.getByRole('tab', { selected: true }).textContent).toBe('Flow')
  })

  it('points aria-controls only at a panel that exists', () => {
    // Just one panel is rendered, so a tab that is not open has nothing to
    // control — and an id nobody carries is a panel a screen reader offers to
    // navigate to and then cannot find.
    render(<TabbedPanel tabs={TABS} />)
    for (const tab of screen.getAllByRole('tab')) {
      const controls = tab.getAttribute('aria-controls')
      if (tab.getAttribute('aria-selected') === 'true') {
        expect(document.getElementById(controls as string)).not.toBeNull()
      } else {
        expect(controls).toBeNull()
      }
    }
  })

  it('gives the panel a tab stop, because the regions scroll and hold nothing focusable', () => {
    render(<TabbedPanel tabs={TABS} />)
    expect(screen.getByRole('tabpanel').tabIndex).toBe(0)
  })

  it('keeps one stop in the tab order, so Tab does not walk the whole strip', () => {
    render(<TabbedPanel tabs={TABS} />)
    const reachable = screen.getAllByRole('tab').filter((tab) => tab.tabIndex === 0)
    expect(reachable).toHaveLength(1)
    expect(reachable[0]?.getAttribute('aria-selected')).toBe('true')
  })

  it('renders one tab and no strip of three when handed one region', () => {
    // The Host that mounts only the Components tab is the case the whole design
    // turns on: nothing here reaches for the other two.
    render(<TabbedPanel tabs={[TABS[0]!]} />)
    expect(screen.getAllByRole('tab')).toHaveLength(1)
    expect(screen.queryByText('flow body')).toBeNull()
  })

  it('survives an empty set rather than assuming a tab exists', () => {
    render(<TabbedPanel tabs={[]} />)
    expect(screen.queryAllByRole('tab')).toHaveLength(0)
    expect(screen.queryByRole('tabpanel')).toBeNull()
  })

  it('labels its panel with the open tab, which is what makes it a tablist', () => {
    render(<TabbedPanel tabs={TABS} />)
    const tab = screen.getByRole('tab', { selected: true })
    const panel = screen.getByRole('tabpanel')
    expect(panel.getAttribute('aria-labelledby')).toBe(tab.id)
    expect(tab.getAttribute('aria-controls')).toBe(panel.id)
  })
})
