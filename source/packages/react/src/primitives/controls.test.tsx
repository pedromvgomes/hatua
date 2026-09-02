import { render, screen } from '@testing-library/react'
import { createRef, useRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Button } from './Button'
import { Input } from './Input'
import { Select } from './Select'
import { Toggle } from './Toggle'
import { useOverflowing, useTextOverflowing } from './useOverflowing'

describe('Button', () => {
  it('defaults to type=button, so one inside a Host form does not submit it', () => {
    render(<Button>Publish</Button>)
    expect(screen.getByRole('button', { name: 'Publish' }).getAttribute('type')).toBe('button')
  })

  it('forwards a ref, which ConfirmDialog needs to focus its confirm action', () => {
    const ref = createRef<HTMLButtonElement>()
    render(<Button ref={ref}>Discard</Button>)
    expect(ref.current?.textContent).toBe('Discard')
  })

  it('does not fire onClick while disabled', async () => {
    const onClick = vi.fn()
    render(
      <Button disabled onClick={onClick}>
        Publish
      </Button>,
    )
    screen.getByRole('button').click()
    expect(onClick).not.toHaveBeenCalled()
  })
})

describe('Input', () => {
  it('announces the error state it paints', () => {
    render(<Input invalid defaultValue="{{ s1." />)
    expect(screen.getByRole('textbox').getAttribute('aria-invalid')).toBe('true')
  })

  it('leaves aria-invalid off when valid, rather than setting it to "false"', () => {
    render(<Input defaultValue="digest" />)
    expect(screen.getByRole('textbox').hasAttribute('aria-invalid')).toBe(false)
  })
})

describe('Select', () => {
  it('renders a native select carrying its options', () => {
    render(
      <Select defaultValue="b" aria-label="Component">
        <option value="a">component.email.send</option>
        <option value="b">core.fork</option>
      </Select>,
    )
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('b')
  })
})

describe('Toggle', () => {
  it('is a switch reporting its state', () => {
    render(<Toggle checked onCheckedChange={() => {}} label="Parallel" />)
    expect(screen.getByRole('switch', { name: 'Parallel' }).getAttribute('aria-checked')).toBe(
      'true',
    )
  })

  it('reports the value it would change to, not the one it holds', () => {
    const onCheckedChange = vi.fn()
    render(<Toggle checked={false} onCheckedChange={onCheckedChange} label="Parallel" />)
    screen.getByRole('switch').click()
    expect(onCheckedChange).toHaveBeenCalledWith(true)
  })

  /*
   * `label={showLabel && 'Parallel'}` is how a caller writes a conditional
   * label, and it produces `false`. When the two branches disagreed about what
   * counted as "no label", that rendered an empty <label> and left the switch —
   * whose only content is an empty span — with no accessible name at all.
   */
  it.each([
    ['false', false],
    ['null', null],
    ['an empty string', ''],
  ])('treats %s as no label, so the switch keeps its name', (_name, label) => {
    render(
      <Toggle checked={false} onCheckedChange={() => {}} label={label} aria-label="Parallel" />,
    )
    expect(screen.getByRole('switch', { name: 'Parallel' })).toBeDefined()
    expect(document.querySelector('label')).toBeNull()
  })

  it('wires its label to the switch, so clicking the text toggles it', () => {
    render(<Toggle checked={false} onCheckedChange={() => {}} label="Parallel" />)
    // getByRole with a name only resolves if the <label for> found its control.
    expect(screen.getByRole('switch', { name: 'Parallel' })).toBeDefined()
  })
})

describe('useOverflowing', () => {
  /*
   * jsdom lays nothing out, so every box measures zero and nothing ever
   * overflows. What can be checked here is the shape of the answer and the
   * paths that do not depend on layout — the rest is verified in a browser,
   * which is where three faults in this hid from the suite.
   */
  const Watched = ({ text }: { text: string }) => {
    const ref = useRef<HTMLDivElement>(null)
    const wide = useOverflowing(ref)
    const long = useTextOverflowing(ref, text)
    return (
      <div ref={ref} data-wide={String(wide)} data-long={String(long)}>
        {text}
      </div>
    )
  }

  it('reports nothing where nothing has been laid out', () => {
    render(<Watched text="anything" />)
    const el = screen.getByText('anything')
    expect(el.getAttribute('data-wide')).toBe('false')
    expect(el.getAttribute('data-long')).toBe('false')
  })

  it('survives an environment with no ResizeObserver', () => {
    const saved = globalThis.ResizeObserver
    // @ts-expect-error — removing it is the point of the check.
    globalThis.ResizeObserver = undefined
    try {
      render(<Watched text="no observer" />)
      expect(screen.getByText('no observer')).toBeDefined()
    } finally {
      globalThis.ResizeObserver = saved
    }
  })

  it('offers nothing where the text cannot be measured at all', () => {
    // No canvas, as here: guessing would be worse than staying quiet.
    render(<Watched text="unmeasurable" />)
    expect(screen.getByText('unmeasurable').getAttribute('data-long')).toBe('false')
  })
})

describe('a Select that nothing is reading the chosen text of', () => {
  /*
   * The listener is on the ELEMENT, so it runs in the target phase — before
   * React's, which is delegated to the root and runs as the event bubbles. A
   * `change` is discrete, so state set there is flushed synchronously: React
   * re-renders the `<select>` mid-dispatch and, on a controlled one, writes
   * `value` back to the prop. The handler that runs next then reads THAT value
   * rather than the option just chosen, and every choice looks like a choice of
   * nothing.
   */
  it('attaches no change listener of its own', () => {
    const listeners: string[] = []
    const original = HTMLSelectElement.prototype.addEventListener
    HTMLSelectElement.prototype.addEventListener = function patched(
      this: HTMLSelectElement,
      type: string,
      ...rest: unknown[]
    ) {
      listeners.push(type)
      return original.call(
        this,
        type,
        ...(rest as [EventListenerOrEventListenerObject, boolean | AddEventListenerOptions]),
      )
    } as typeof original

    try {
      render(
        <Select aria-label="Pick" value="" onChange={() => {}}>
          <option value="">—</option>
          <option value="a">A</option>
        </Select>,
      )
    } finally {
      HTMLSelectElement.prototype.addEventListener = original
    }

    expect(listeners).not.toContain('change')
  })

  it('still attaches one when a tooltip is going to read it', () => {
    const listeners: string[] = []
    const original = HTMLSelectElement.prototype.addEventListener
    HTMLSelectElement.prototype.addEventListener = function patched(
      this: HTMLSelectElement,
      type: string,
      ...rest: unknown[]
    ) {
      listeners.push(type)
      return original.call(
        this,
        type,
        ...(rest as [EventListenerOrEventListenerObject, boolean | AddEventListenerOptions]),
      )
    } as typeof original

    try {
      render(
        <Select aria-label="Pick" revealOnOverflow value="" onChange={() => {}}>
          <option value="">—</option>
        </Select>,
      )
    } finally {
      HTMLSelectElement.prototype.addEventListener = original
    }

    expect(listeners).toContain('change')
  })
})
