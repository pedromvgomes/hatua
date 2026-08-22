import type { ScopeEntry } from '@hatua/model'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ExpressionPicker } from './ExpressionPicker'
import { REFERENCE_MIME } from './insertion'

/**
 * The browsable half, driven through its props.
 *
 * A compound takes props in and sends events out, which is what makes this
 * testable without a store, a document or a Host — the same property that lets
 * one input serve a variable's value, a Trigger's field and a Step's field.
 */
const SCOPE: ScopeEntry[] = [
  { path: 'run.tenant', kind: 'context', label: 'Tenant', type: { type: 'text' } },
  { path: 'var.digest_to', kind: 'var', label: 'digest_to', type: { type: 'text' } },
  {
    path: 's2',
    kind: 'step',
    label: 'Fetch emails',
    type: {
      type: 'object',
      members: {
        count: { type: 'number' },
        messages: { type: 'list', members: { subject: { type: 'text' } } },
      },
    },
  },
]

const mount = (props: Partial<Parameters<typeof ExpressionPicker>[0]> = {}) => {
  const onChoose = vi.fn()
  const onClose = vi.fn()
  render(
    <ExpressionPicker
      scope={SCOPE}
      expected="text"
      anchor={{ left: 20, top: 100, bottom: 140 }}
      onChoose={onChoose}
      onClose={onClose}
      {...props}
    />,
  )
  return { onChoose, onClose }
}

const rows = () => screen.getAllByRole('button').filter((b) => b.hasAttribute('draggable'))
const rowNamed = (path: string) =>
  rows().find((row) => row.textContent?.startsWith(path)) as HTMLElement

describe('the Reference tab', () => {
  it('opens on it, because reading a value is the common case', () => {
    mount()
    expect(screen.getByRole('tab', { name: 'Reference' }).getAttribute('aria-selected')).toBe(
      'true',
    )
  })

  /* Group headers show only under *Everything*; with one source chosen the
     select above already says which. */
  it('groups by where a value comes from', () => {
    mount()
    expect(screen.getByRole('heading', { name: /Run context/ })).toBeDefined()
    expect(screen.getByRole('heading', { name: /Fetch emails/ })).toBeDefined()
    expect(rowNamed('run.tenant')).toBeDefined()
    expect(rowNamed('s2.messages[].subject')).toBeDefined()
  })

  it('narrows to one source, and drops the headings with it', () => {
    mount()
    fireEvent.change(screen.getByLabelText('What to read from'), { target: { value: 's2' } })
    expect(screen.queryByRole('heading', { name: /Run context/ })).toBeNull()
    expect(rowNamed('run.tenant')).toBeUndefined()
    expect(rowNamed('s2.count')).toBeDefined()
  })

  /* A grouping prefix is not addressable, so it contributes its children and
     never itself. */
  it('offers no row for a root that names nothing', () => {
    mount()
    expect(rows().some((row) => row.textContent?.startsWith('run '))).toBe(false)
  })

  it('inserts the bare path, leaving the delimiters to the field', () => {
    const { onChoose } = mount()
    fireEvent.click(rowNamed('s2.count'))
    expect(onChoose).toHaveBeenCalledWith('s2.count')
  })

  /*
   * Two MIME types, because two readers want different things: a Hatua field
   * wants the path, and any other editor on the page should still paste
   * something meaningful.
   */
  it('carries both payloads when a row is dragged', () => {
    mount()
    const setData = vi.fn()
    fireEvent.dragStart(rowNamed('s2.count'), {
      dataTransfer: { setData, effectAllowed: '' },
    })
    expect(setData).toHaveBeenCalledWith(REFERENCE_MIME, 's2.count')
    expect(setData).toHaveBeenCalledWith('text/plain', '{{ s2.count }}')
  })

  /* Green means "fits here"; nothing is ever marked wrong. */
  it('marks the rows that produce what the field declares', () => {
    mount({ expected: 'number' })
    expect(rowNamed('s2.count').getAttribute('data-fits')).toBe('true')
    expect(rowNamed('var.digest_to').getAttribute('data-fits')).toBeNull()
  })

  it('marks nothing where nothing declares a type', () => {
    mount({ expected: undefined })
    expect(rowNamed('s2.count').getAttribute('data-fits')).toBeNull()
  })

  it('says so when there is nothing to read', () => {
    mount({ scope: [] })
    expect(screen.getByText('There is nothing to read here yet.')).toBeDefined()
  })
})

describe('the Function tab', () => {
  const open = () => fireEvent.click(screen.getByRole('tab', { name: 'Function' }))

  it('offers every Function, with its namespace summary', () => {
    mount()
    open()
    expect(screen.getByText('Everything that can be called from an expression.')).toBeDefined()
    expect(screen.getByRole('button', { name: /dt\.now/ })).toBeDefined()
  })

  it('narrows to one namespace and describes it', () => {
    mount()
    open()
    fireEvent.change(screen.getByLabelText('Which functions'), { target: { value: 'num' } })
    expect(screen.getByText(/Dividing always gives a decimal/)).toBeDefined()
    expect(screen.queryByRole('button', { name: /dt\.now/ })).toBeNull()
  })

  it('marks a Function by what it returns', () => {
    mount({ expected: 'datetime' })
    open()
    expect(screen.getByRole('button', { name: /dt\.now/ }).getAttribute('data-fits')).toBe('true')
    expect(screen.getByRole('button', { name: /text\.upper/ }).getAttribute('data-fits')).toBeNull()
  })
})

describe('the inserter', () => {
  const openInserter = (name: RegExp) => {
    fireEvent.click(screen.getByRole('tab', { name: 'Function' }))
    fireEvent.click(screen.getByRole('button', { name }))
  }

  it('gives every parameter its own sentence, which is why they are declared', () => {
    mount()
    openInserter(/dt\.add/)
    expect(screen.getByText('The date and time to move.')).toBeDefined()
    expect(screen.getByText('One of seconds, minutes, hours or days.')).toBeDefined()
    // Nothing about dt.add is optional, so nothing says so.
    expect(screen.queryByText('optional')).toBeNull()
  })

  it('says which parameters may be left out', () => {
    mount()
    openInserter(/text\.slice/)
    expect(screen.getAllByText('optional')).toHaveLength(1)
  })

  it('previews the call, with what is unfilled shown as a placeholder', () => {
    mount()
    openInserter(/dt\.add/)
    expect(screen.getByText('dt.add(<value>, <amount>, <unit>)')).toBeDefined()
  })

  it('composes what is typed into it', () => {
    const { onChoose } = mount()
    openInserter(/dt\.add/)
    fireEvent.change(screen.getByLabelText('value'), { target: { value: 'run.started_at' } })
    fireEvent.change(screen.getByLabelText('amount'), { target: { value: '2' } })
    fireEvent.change(screen.getByLabelText('unit'), { target: { value: "'days'" } })

    expect(screen.getByText("dt.add(run.started_at, 2, 'days')")).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }))
    expect(onChoose).toHaveBeenCalledWith("dt.add(run.started_at, 2, 'days')")
  })

  /*
   * An unfilled optional is an argument nobody asked for, and the arity check
   * counts arguments — so trailing ones are dropped rather than passed as a
   * placeholder.
   */
  it('drops a trailing optional nobody filled in', () => {
    const { onChoose } = mount()
    openInserter(/text\.slice/)
    fireEvent.change(screen.getByLabelText('value'), { target: { value: 's2.subject' } })
    fireEvent.change(screen.getByLabelText('start'), { target: { value: '0' } })

    fireEvent.click(screen.getByRole('button', { name: 'Insert' }))
    expect(onChoose).toHaveBeenCalledWith('text.slice(s2.subject, 0)')
  })

  it('keeps an optional the user did fill in', () => {
    const { onChoose } = mount()
    openInserter(/text\.slice/)
    for (const [name, value] of [
      ['value', 's2.subject'],
      ['start', '0'],
      ['end', '8'],
    ]) {
      fireEvent.change(screen.getByLabelText(name as string), { target: { value } })
    }
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }))
    expect(onChoose).toHaveBeenCalledWith('text.slice(s2.subject, 0, 8)')
  })

  /* It inserts and never round-trips, so reopening starts fresh. */
  it('forgets what was typed when it is left and opened again', () => {
    mount()
    openInserter(/dt\.add/)
    fireEvent.change(screen.getByLabelText('value'), { target: { value: 'run.started_at' } })
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    openInserter(/dt\.add/)
    expect((screen.getByLabelText('value') as HTMLInputElement).value).toBe('')
  })

  it('takes no arguments where a Function has none', () => {
    const { onChoose } = mount()
    openInserter(/dt\.now/)
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }))
    expect(onChoose).toHaveBeenCalledWith('dt.now()')
  })
})

describe('dismissing it', () => {
  it('closes on Escape', () => {
    const { onClose } = mount()
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Insert' }), { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('closes on a click outside, which is what the backdrop is for', () => {
    const { onClose } = mount()
    const backdrop = document.querySelector('[aria-hidden="true"]') as HTMLElement
    fireEvent.mouseDown(backdrop)
    expect(onClose).toHaveBeenCalled()
  })

  it('names itself, so what it is for is not left to the tabs alone', () => {
    mount()
    const panel = screen.getByRole('dialog', { name: 'Insert' })
    expect(within(panel).getByRole('tablist', { name: 'What to insert' })).toBeDefined()
  })
})
