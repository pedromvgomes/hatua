import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, useRef, useState } from 'react'
import { Input } from './Input'
import { Select } from './Select'
import { Tooltip } from './Tooltip'

/**
 * The tooltip, and the two controls that opt into it.
 *
 * Each story is rendered twice, once per pinned colour mode. The layer is shown
 * by pointing at the control it belongs to, so these open one on mount — the
 * same `pointerenter` a pointer sends.
 */
const meta = { title: 'Primitives/Tooltip' } satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

/** Opens the tooltip on the control inside it, once, the way a pointer would. */
function Hovered({ children }: { children: React.ReactNode }) {
  const host = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // A frame later: the tooltip listens only once it knows there is something
    // to say, and whether the box is showing less than it holds is measured
    // after the render that drew it.
    const frame = requestAnimationFrame(() => {
      const control = host.current?.querySelector('input, select')
      control?.dispatchEvent(new PointerEvent('pointerenter', { bubbles: false }))
    })
    return () => cancelAnimationFrame(frame)
  }, [])

  return (
    <div ref={host} style={{ maxWidth: 240, minHeight: 180 }}>
      {children}
    </div>
  )
}

const LONG = '{{ triggers.overnight.message.subject }} — {{ run.tenant.name }}'

/** An input showing less than it holds, with the whole value on offer. */
export const InputOnOverflow: Story = {
  render: () => (
    <Hovered>
      <Input revealOnOverflow value={LONG} readOnly aria-label="Subject" />
    </Hovered>
  ),
}

/**
 * The ordinary case, and the reason it is opt-in: a value that fits offers
 * nothing, and describes nothing either — an `aria-describedby` pointing at
 * text already fully visible reads it out twice.
 */
export const InputThatFits: Story = {
  render: () => (
    <Hovered>
      <Input revealOnOverflow value="me@dane.dev" readOnly aria-label="To" />
    </Hovered>
  ),
}

export const SelectOnOverflow: Story = {
  render: () => (
    <Hovered>
      <Select revealOnOverflow defaultValue="long" aria-label="Mailbox">
        <option value="long">Operations mailbox · shared · eu-west-1 · ops@example.com</option>
        <option value="short">Ops</option>
      </Select>
    </Hovered>
  ),
}

/**
 * A node rather than a string, which is the case the API exists for: the
 * interesting content is often already rendered, and describing it again as
 * text would say it twice.
 */
export const RichContent: Story = {
  render: function Rich() {
    const anchor = useRef<HTMLInputElement>(null)
    const [ready, setReady] = useState(false)

    useEffect(() => {
      setReady(true)
      const frame = requestAnimationFrame(() =>
        anchor.current?.dispatchEvent(new PointerEvent('pointerenter', { bubbles: false })),
      )
      return () => cancelAnimationFrame(frame)
    }, [])

    return (
      <div style={{ maxWidth: 240, minHeight: 180 }}>
        <Input ref={anchor} value="3 problems" readOnly aria-label="Problems" />
        {ready ? (
          <Tooltip
            anchor={anchor}
            content={
              <ul style={{ margin: 0, paddingInlineStart: 16 }}>
                <li>Mailbox is required.</li>
                <li>Nothing named s9 is in scope here.</li>
                <li>This expression expects text.</li>
              </ul>
            }
          />
        ) : null}
      </div>
    )
  },
}
