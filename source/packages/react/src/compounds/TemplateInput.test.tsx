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

  /*
   * Completion follows typing, never caret placement — and editing the
   * characters is typing, whichever key does it. Offering the list only on `{{`
   * left someone who deleted their way back to `{{ var. }}` with no completion
   * at all, in the one place they most obviously wanted some.
   */
  it('offers the list while a hole is being edited, not only when one is opened', () => {
    const { field } = mount({ value: '{{ s2.count }}' })
    const input = field as HTMLInputElement
    fireEvent.focus(field)
    fireEvent.change(field, {
      target: { value: '{{ s2.coun }}', selectionStart: 10, selectionEnd: 10 },
    })
    expect(screen.getByRole('listbox')).toBeDefined()
    expect(input.value).toBe('{{ s2.coun }}')
  })

  it('keeps it shut after Escape until the caret leaves the hole', () => {
    const { field } = mount({ value: '{{ s2.count }}' })
    fireEvent.focus(field)
    fireEvent.change(field, {
      target: { value: '{{ s2.coun }}', selectionStart: 10, selectionEnd: 10 },
    })
    fireEvent.keyDown(field, { key: 'Escape' })
    fireEvent.change(field, {
      target: { value: '{{ s2.cou }}', selectionStart: 9, selectionEnd: 9 },
    })
    expect(screen.queryByRole('listbox')).toBeNull()

    // Asking again is what reopens it.
    fireEvent.keyDown(field, { key: ' ', ctrlKey: true, target: { selectionStart: 9 } })
    expect(screen.getByRole('listbox')).toBeDefined()
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

describe('at rest', () => {
  /** The outer chip, by the offset it stands for — its parts are spans too. */
  const chips = () =>
    [...document.querySelectorAll('span')]
      .filter((span) => span.hasAttribute('data-hole'))
      .map((span) => span.textContent)

  /*
   * With no caret to keep aligned the mirror is free to be a different width
   * from the input behind it, which is exactly what showing a label instead of
   * a path requires.
   */
  it('draws a whole-value Reference as what it names', () => {
    mount({ value: '{{ s2.count }}' })
    // The source and the value, in that order — a chip carrying only a label
    // loses the half that says where the value is from.
    expect(chips()).toEqual(['Fetch emailscount'])
  })

  it('draws a Reference inside a sentence the same way', () => {
    mount({ value: 'Inbox digest · {{ s2.count }} messages' })
    expect(chips()).toEqual(['Fetch emailscount'])
  })

  /* A Reference is a shape, not a syntax: the moment something is computed
     there is no single target to name. */
  it('leaves an expression that computes something as its own characters', () => {
    mount({ value: '{{ s2.count + 1 }}' })
    expect(chips()).toEqual([])
  })

  /* The path is what the checker names and what has to be edited. */
  it('leaves a stale Reference showing its path', () => {
    mount({ value: '{{ s9.gone }}' })
    expect(chips()).toEqual([])
  })

  it('puts the characters back on focus, so the text is the editing surface', () => {
    const { field } = mount({ value: '{{ s2.count }}' })
    fireEvent.focus(field)
    expect(chips()).toEqual([])
  })
})

describe('how the mirror is built', () => {
  const runs = () => [...document.querySelectorAll('[data-at]')]
  const braces = () =>
    [...document.querySelectorAll('span')]
      .filter((span) => span.className.startsWith('_brace'))
      .map((span) => span.textContent)

  /*
   * `{{` and `}}` are how a Template spells a hole, not part of what it names.
   * Colour only — anything that changed their width would slide the mirror off
   * the text it stands in for.
   */
  it('steps the delimiters back while the characters are showing', () => {
    const { field } = mount({ value: 'Hi {{ s2.count }} there' })
    fireEvent.focus(field)
    expect(braces()).toEqual(['{{', '}}'])
  })

  it('leaves a hole with nothing closing it a single delimiter', () => {
    const { field } = mount({ value: 'Hi {{ s2.co' })
    fireEvent.focus(field)
    expect(braces()).toEqual(['{{'])
  })

  /*
   * The invariant `offsetAtPoint` rests on: it translates a click into an
   * offset by finding the run under the pointer and adding the offset within
   * its text, so a run whose text does not begin where `data-at` says would put
   * the caret somewhere else entirely.
   */
  it('gives every run the offset its text actually begins at', () => {
    const value = 'Hi {{ s2.count }} and {{ s9.gone }} end'
    const { field } = mount({ value })
    fireEvent.focus(field)

    const checked = runs().filter((run) => !run.hasAttribute('data-hole'))
    expect(checked.length).toBeGreaterThan(3)
    for (const run of checked) {
      const at = Number(run.getAttribute('data-at'))
      expect(value.slice(at, at + (run.textContent?.length ?? 0))).toBe(run.textContent)
    }
  })

  it('holds it at rest too, where a click is the only way in', () => {
    const value = 'Inbox digest · {{ s2.count }} messages'
    mount({ value })
    for (const run of runs().filter((r) => !r.hasAttribute('data-hole'))) {
      const at = Number(run.getAttribute('data-at'))
      expect(value.slice(at, at + (run.textContent?.length ?? 0))).toBe(run.textContent)
    }
  })
})
