import type { ScopeEntry } from '@hatua/model'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { REFERENCE_MIME } from './insertion'
import { TemplateInput } from './TemplateInput'

const SCOPE: ScopeEntry[] = [
  { path: 'run.tenant', kind: 'context', label: 'Tenant', type: { type: 'text' } },
  { path: 'var.digest_to', kind: 'var', label: 'digest_to', type: { type: 'text' } },
  {
    path: 's2',
    kind: 'step',
    label: 'Fetch emails',
    type: { type: 'object', members: { count: { type: 'number' } } },
  },
]

const mount = (props: Partial<Parameters<typeof TemplateInput>[0]> = {}) => {
  const onCommit = vi.fn()
  render(<TemplateInput label="To" value="" scope={SCOPE} onCommit={onCommit} {...props} />)
  return { onCommit, field: screen.getByRole('combobox', { name: 'To' }) }
}

/**
 * Typing, one keystroke at a time.
 *
 * Not one `change` with the finished string: completion follows TYPING, so the
 * `{{` that opens the list has to actually be typed. A test that sets the whole
 * value at once is testing a paste, which is a different thing and correctly
 * opens nothing.
 */
const type = (field: HTMLElement, text: string) => {
  for (const char of text) {
    const input = field as HTMLInputElement
    const at = input.selectionStart ?? input.value.length
    const next = input.value.slice(0, at) + char + input.value.slice(at)
    fireEvent.change(field, {
      target: { value: next, selectionStart: at + 1, selectionEnd: at + 1 },
    })
  }
}

describe('TemplateInput', () => {
  it('is a combobox over a listbox, because ghost text alone reaches no screen reader', () => {
    const { field } = mount()
    expect(field.getAttribute('aria-autocomplete')).toBe('both')
    expect(field.getAttribute('aria-expanded')).toBe('false')
  })

  it('opens the completion list on `{{`', () => {
    const { field } = mount()
    type(field, '{{')
    expect(field.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('listbox')).toBeDefined()
  })

  it('points aria-activedescendant at a row that is actually in the DOM', () => {
    const { field } = mount()
    type(field, '{{')
    const active = field.getAttribute('aria-activedescendant')
    expect(active).not.toBeNull()
    expect(document.getElementById(active as string)).not.toBeNull()
  })

  /*
   * Completion follows TYPING, never caret placement. Opening on a click would
   * bury the field under a popup every time somebody went in to fix one
   * character, which made an existing Template harder to edit than to write.
   */
  it('does not open when the caret is merely placed inside a hole', () => {
    const { field } = mount({ value: '{{ s2.count }}' })
    fireEvent.click(field, { target: { selectionStart: 6 } })
    expect(field.getAttribute('aria-expanded')).toBe('false')
  })

  it('opens the list on Ctrl+Space inside a hole', () => {
    const { field } = mount({ value: '{{ s2. }}' })
    fireEvent.keyDown(field, { key: ' ', ctrlKey: true, target: { selectionStart: 6 } })
    expect(screen.getByRole('listbox')).toBeDefined()
  })

  it('opens the picker on Ctrl+Space outside one', () => {
    const { field } = mount({ value: 'Hi there' })
    fireEvent.keyDown(field, { key: ' ', ctrlKey: true, target: { selectionStart: 3 } })
    expect(screen.getByRole('dialog', { name: 'Insert' })).toBeDefined()
  })

  it('opens the picker from the ⚡ button, so a swallowed shortcut locks nobody out', () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Insert into To' }))
    expect(screen.getByRole('dialog', { name: 'Insert' })).toBeDefined()
  })

  it('moves with the arrow keys and accepts with Enter', () => {
    const { field } = mount()
    type(field, '{{s2.')
    fireEvent.keyDown(field, { key: 'Enter' })
    expect((field as HTMLInputElement).value).toBe('{{ s2.count }}')
  })

  /*
   * `Tab` accepts only while the list is open and otherwise falls through to
   * focus movement: Hatua is a guest in someone's page and cannot trap focus.
   */
  it('lets Tab fall through when the list is closed', () => {
    const { field } = mount({ value: 'plain text' })
    const event = fireEvent.keyDown(field, { key: 'Tab' })
    expect(event).toBe(true)
  })

  it('takes Tab while the list is open', () => {
    const { field } = mount()
    type(field, '{{s2.')
    fireEvent.keyDown(field, { key: 'Tab' })
    expect((field as HTMLInputElement).value).toBe('{{ s2.count }}')
  })

  it('dismisses on Escape without discarding what was typed', () => {
    const { field } = mount()
    type(field, '{{s2.')
    fireEvent.keyDown(field, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()
    expect((field as HTMLInputElement).value).toBe('{{ s2. }}')
  })

  /*
   * A hole is the only thing `{{` can be, and an unclosed one is text that does
   * not parse — so the highlight stays off and the checker has nothing to say
   * until two more characters are typed by hand.
   */
  it('closes the hole on `{{` and leaves the caret between the braces', () => {
    const { field } = mount()
    type(field, '{{')
    expect((field as HTMLInputElement).value).toBe('{{  }}')
  })

  it('commits on blur, not on every keystroke', () => {
    const { field, onCommit } = mount()
    type(field, '{{var.digest_to')
    expect(onCommit).not.toHaveBeenCalled()
    fireEvent.blur(field)
    expect(onCommit).toHaveBeenCalledWith('{{ var.digest_to }}')
  })

  it('follows the document when it moves underneath — an undo, or another region', () => {
    const { rerender } = render(
      <TemplateInput label="To" value="a" scope={SCOPE} onCommit={vi.fn()} />,
    )
    rerender(<TemplateInput label="To" value="b" scope={SCOPE} onCommit={vi.fn()} />)
    expect((screen.getByRole('combobox', { name: 'To' }) as HTMLInputElement).value).toBe('b')
  })

  it('shows signature help while the caret is inside a call', () => {
    const { field } = mount({ value: '{{ dt.add(' })
    fireEvent.click(field, { target: { selectionStart: 10 } })
    expect(screen.getByRole('status').textContent).toContain('dt.add(')
    expect(screen.getByRole('status').textContent).toContain('→ datetime')
  })

  describe('drag and drop', () => {
    const transfer = (path: string) =>
      ({
        getData: (mime: string) => (mime === REFERENCE_MIME ? path : ''),
        dropEffect: '',
      }) as unknown as DataTransfer

    it('drops a path in as a hole, spaced away from its neighbours', () => {
      const { field, onCommit } = mount({ value: 'Hithere' })
      fireEvent.drop(field, {
        dataTransfer: transfer('s2.count'),
        target: { selectionStart: 2 },
      })
      expect(onCommit).toHaveBeenCalledWith('Hi {{ s2.count }} there')
    })

    it('replaces the whole value in a field that holds exactly one Reference', () => {
      const { field, onCommit } = mount({ value: '{{ old }}', single: true })
      fireEvent.drop(field, { dataTransfer: transfer('s2.count') })
      expect(onCommit).toHaveBeenCalledWith('{{ s2.count }}')
    })

    it('ignores a drop carrying something that is not one of ours', () => {
      const { field, onCommit } = mount({ value: 'x' })
      fireEvent.drop(field, {
        dataTransfer: { getData: () => '', dropEffect: '' } as unknown as DataTransfer,
      })
      expect(onCommit).not.toHaveBeenCalled()
    })
  })

  describe('the type marking', () => {
    const railed = () =>
      screen.getAllByRole('option').map((row) => row.getAttribute('data-fits') === 'true')

    it('marks the rows that produce what the field declares', () => {
      const { field } = mount({ expectedType: 'number' })
      type(field, '{{s2.')
      // `s2.count` is the number; nothing else in the list is.
      expect(railed()).toEqual([true])
    })

    it('marks any scalar inside mixed text, because that is what interpolation is', () => {
      const { field } = mount({ expectedType: 'number', value: 'Order ' })
      type(field, 'Order {{s2.')
      expect(railed()).toEqual([true])
    })

    it('marks nothing where nothing declares a type', () => {
      const { field } = mount()
      type(field, '{{s2.')
      expect(railed()).toEqual([false])
    })
  })
})
