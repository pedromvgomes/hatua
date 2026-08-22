import type { ScopeEntry } from '@hatua/model'
import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
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
   * The list rebuilds under the selection on every keystroke, so what it points
   * at has to keep existing — an id naming nothing is a row a screen reader
   * announces and then cannot find.
   */
  it('keeps pointing at one, however far down the list the selection has moved', () => {
    const { field } = mount()
    type(field, '{{')
    for (let i = 0; i < 6; i++) fireEvent.keyDown(field, { key: 'ArrowDown' })

    for (const more of ['s', '2', '.']) {
      type(field, more)
      const active = field.getAttribute('aria-activedescendant')
      expect(active, `after "${more}"`).not.toBeNull()
      expect(document.getElementById(active as string), `after "${more}"`).not.toBeNull()
    }
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

  /*
   * Asked of the two characters before the caret alone, the auto-close fires on
   * the way out as well as on the way in: backspacing through `{{ s2.count }}`
   * reaches a caret sitting just after a `{{`, and every further press added
   * another `}}`.
   */
  it('does not close the hole again on the way back out of one', () => {
    const { field } = mount({ value: '{{ s2.count }}' })
    const input = field as HTMLInputElement
    fireEvent.focus(field)

    // Backspace, character by character, from just after `s2.count`.
    for (let caret = 11; caret > 2; caret--) {
      fireEvent.change(field, {
        target: {
          value: input.value.slice(0, caret - 1) + input.value.slice(caret),
          selectionStart: caret - 1,
          selectionEnd: caret - 1,
        },
      })
    }
    expect(input.value).toBe('{{ }}')
  })

  /*
   * The `{{` is closed for you, so the caret sits three characters inside
   * `{{ | }}` — and walking out with the arrow key took three presses. Typing
   * the closing brace steps over the whole closer at once, which is what every
   * editor that auto-closes a bracket does, and is the keystroke somebody would
   * have pressed anyway.
   */
  it('steps over the closing braces when they are typed', () => {
    const { field } = mount()
    const input = field as HTMLInputElement
    type(field, '{{s2.count')
    expect(input.value).toBe('{{ s2.count }}')

    fireEvent.keyDown(field, { key: '}', target: { selectionStart: 11 } })
    expect(input.selectionStart).toBe(14)
    expect(input.value).toBe('{{ s2.count }}')
  })

  it('types a brace normally where there is no closer to step over', () => {
    const { field } = mount({ value: 'plain' })
    const event = fireEvent.keyDown(field, { key: '}', target: { selectionStart: 5 } })
    expect(event).toBe(true)
  })

  /* A pasted Template is already closed; closing it again is the same fault
     with a different trigger. */
  it('does not close a `{{` that arrived by paste', () => {
    const { field } = mount()
    fireEvent.change(field, {
      target: { value: '{{ s2.count }}', selectionStart: 14, selectionEnd: 14 },
    })
    expect((field as HTMLInputElement).value).toBe('{{ s2.count }}')
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

  /*
   * Counted as ordinary characters, the `(` in a text literal opens a call that
   * never closes and the strip goes on naming a parameter of it for the rest of
   * the hole.
   */
  it('steps over a paren inside a text literal', () => {
    const value = "{{ text.join(items, '(') }}"
    const { field } = mount({ value })
    // Inside the hole and past the `)` that closed the call — outside it, this
    // would pass for the wrong reason, because nothing is counted there at all.
    expect(value[23]).toBe(')')
    fireEvent.click(field, { target: { selectionStart: 24 } })
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('still finds the call when a literal holds a paren', () => {
    const { field } = mount({ value: "{{ text.join(items, '(') }}" })
    fireEvent.click(field, { target: { selectionStart: 20 } })
    expect(screen.getByRole('status').textContent).toContain('text.join(')
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

  /*
   * A hole is a hole whether or not it names one value, and one drawn as bare
   * text among the words around it is the only thing on the line that does not
   * look like what it is. What differs is what the chip can say: a Reference is
   * a shape, not a syntax, and the moment something is computed there is no
   * single source to name — so the chip shows its own text instead.
   */
  it('draws an expression that computes something as its own text', () => {
    mount({ value: '{{ s2.count + 1 }}' })
    // `s2` is a Step's id, and putting it on a chip is the thing a chip exists
    // to stop — so the Reference inside is named too, and only the operators
    // and literals are left as they were written.
    expect(chips()).toEqual(['Fetch emailscount + 1'])
  })

  /* The path is what the checker names and what has to be edited, so a stale
     Reference keeps showing it — and the missing source is the signal. */
  it('draws a stale Reference as its path, with no source', () => {
    mount({ value: '{{ s9.gone }}' })
    expect(chips()).toEqual(['s9.gone'])
  })

  it('names every Reference in a computed hole, and leaves the rest verbatim', () => {
    mount({ value: '{{ s2.count + run.tenant }}' })
    expect(chips()).toEqual(['Fetch emailscount + Run contextTenant'])
  })

  /* Substituted by span and only where the source agrees, so nothing is ever
     reconstructed from the tree — that would be AST→text (ADR-0008). */
  it('leaves a path it cannot match character for character alone', () => {
    mount({ value: '{{ s9.gone + 1 }}' })
    expect(chips()).toEqual(['s9.gone + 1'])
  })

  /* Its characters are the only thing that can be edited back into shape. */
  it('leaves a hole that does not parse as its own characters', () => {
    mount({ value: '{{ s2. + }}' })
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

describe('the rest of the ways through', () => {
  it('accepts the ghost with ArrowRight at the end of the value', () => {
    const { field } = mount()
    const input = field as HTMLInputElement
    type(field, '{{run.te')
    // The list has narrowed to one, so the ghost completes the rest of it.
    fireEvent.keyDown(field, { key: 'ArrowRight', target: { selectionStart: input.value.length } })
    expect(input.value).toContain('run.tenant')
  })

  it('restores the committed value on Escape with nothing open', () => {
    const { field, onCommit } = mount({ value: 'kept' })
    const input = field as HTMLInputElement
    fireEvent.change(field, { target: { value: 'thrown away', selectionStart: 11 } })
    fireEvent.keyDown(field, { key: 'Escape' })
    expect(input.value).toBe('kept')
    expect(onCommit).not.toHaveBeenCalled()
  })

  /*
   * The whole value out, not the caret position: a picker choice is a finished
   * edit rather than something still being typed, so it commits at once.
   *
   * The box does not keep it here, and that is the contract rather than a
   * fault: the parent below ignores the event, so the field follows the
   * document straight back — which is exactly what an undo does.
   */
  it('commits what the picker chose', () => {
    const { onCommit } = mount()
    fireEvent.click(screen.getByRole('button', { name: 'Insert into To' }))
    const row = screen
      .getAllByRole('button')
      .find((button) => button.textContent?.startsWith('s2.count')) as HTMLElement
    fireEvent.click(row)
    expect(onCommit).toHaveBeenCalledWith('{{ s2.count }}')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('keeps what the picker chose once the document accepts it', () => {
    const Held = () => {
      const [value, setValue] = useState('')
      return <TemplateInput label="To" value={value} scope={SCOPE} onCommit={setValue} />
    }
    render(<Held />)
    fireEvent.click(screen.getByRole('button', { name: 'Insert into To' }))
    const row = screen
      .getAllByRole('button')
      .find((button) => button.textContent?.startsWith('s2.count')) as HTMLElement
    fireEvent.click(row)
    expect((screen.getByRole('combobox', { name: 'To' }) as HTMLInputElement).value).toBe(
      '{{ s2.count }}',
    )
  })

  it('leaves a click alone once the characters are showing', () => {
    // With the text back, the platform is measuring what is actually on screen
    // and does it better than this can.
    const { field } = mount({ value: 'Hi {{ s2.count }}' })
    fireEvent.focus(field)
    const event = fireEvent.mouseDown(field, { clientX: 10, clientY: 10 })
    expect(event).toBe(true)
  })

  it('draws a mark for every kind a value can come from', () => {
    mount({ value: '{{ s2.count }} {{ var.digest_to }} {{ run.tenant }}' })
    const marks = [...document.querySelectorAll('svg')].filter((svg) =>
      svg.className.baseVal.startsWith('_mark'),
    )
    expect(marks).toHaveLength(3)
    // Each kind draws a different shape, or the mark says nothing.
    const shapes = marks.map((mark) => mark.innerHTML)
    expect(new Set(shapes).size).toBe(3)
  })

  it('renders a textarea where the field kind asks for one', () => {
    mount({ multiline: true, value: 'line one\nline two' })
    expect(screen.getByLabelText('To').tagName).toBe('TEXTAREA')
  })

  it('follows the input sideways, so the highlight stays on the text', () => {
    const { field } = mount({ value: 'a'.repeat(200) })
    const mirror = document.querySelector('[aria-hidden="true"]') as HTMLDivElement
    fireEvent.scroll(field, { target: { scrollLeft: 42 } })
    expect(mirror.scrollLeft).toBe(42)
  })
})

describe('double-clicking a hole', () => {
  /*
   * The one gesture that retargets an existing Reference in a single go, which
   * is what CONTEXT.md means by a Reference being something the builder can
   * draw as a pill the user retargets. Everything else lands at the caret; this
   * takes the hole's place.
   */
  const retarget = (field: HTMLElement, at: number) => {
    fireEvent.focus(field)
    fireEvent.click(field, { target: { selectionStart: at } })
    fireEvent.mouseDown(field, { detail: 2 })
  }

  it('opens the picker scoped to the hole under it', () => {
    const { field } = mount({ value: 'Hi {{ s2.count }} there' })
    retarget(field, 10)
    expect(screen.getByRole('dialog', { name: 'Insert' })).toBeDefined()
  })

  it('replaces that hole rather than writing into it', () => {
    const { field, onCommit } = mount({ value: 'Hi {{ s2.count }} there' })
    retarget(field, 10)
    const row = screen
      .getAllByRole('button')
      .find((button) => button.textContent?.startsWith('var.digest_to')) as HTMLElement
    fireEvent.click(row)
    expect(onCommit).toHaveBeenCalledWith('Hi {{ var.digest_to }} there')
  })

  it('replaces it with a call just as readily', () => {
    const { field, onCommit } = mount({ value: '{{ s2.count }}' })
    retarget(field, 6)
    fireEvent.click(screen.getByRole('tab', { name: 'Function' }))
    fireEvent.click(screen.getByRole('button', { name: /dt\.now/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }))
    expect(onCommit).toHaveBeenCalledWith('{{ dt.now() }}')
  })

  /*
   * `caretContext` reports a hole's end as the next `}}` ANYWHERE, so an
   * unterminated `{{` borrows the closer of a later hole — and replacing that
   * range took the later hole and the prose between it away. A hole worth
   * retargeting is one the shape found, which means one that is genuinely
   * closed.
   */
  it('refuses to retarget where a stray brace has swallowed the hole after it', () => {
    const { field, onCommit } = mount({ value: 'Hi {{ oops, then {{ s2.count }} end' })
    retarget(field, 24)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('retargets a hole that parsed, beside one that did not', () => {
    const { field, onCommit } = mount({ value: '{{ a. }}{{ s2.count }}' })
    retarget(field, 14)
    const row = screen
      .getAllByRole('button')
      .find((button) => button.textContent?.startsWith('var.digest_to')) as HTMLElement
    fireEvent.click(row)
    expect(onCommit).toHaveBeenCalledWith('{{ a. }}{{ var.digest_to }}')
  })

  it('refuses the one that did not parse', () => {
    const { field } = mount({ value: '{{ a. }}{{ s2.count }}' })
    retarget(field, 5)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  /*
   * The picker takes no focus, so the text can be edited from under it — and a
   * span captured before that lands somewhere else entirely: typing one
   * character at the start turned the retarget into `!Hi{{ … }}} there`.
   */
  it('forgets what it was aiming at once the text moves', () => {
    const { field, onCommit } = mount({ value: 'Hi {{ s2.count }} there' })
    retarget(field, 10)
    fireEvent.change(field, {
      target: { value: '!Hi {{ s2.count }} there', selectionStart: 1 },
    })
    const row = screen
      .getAllByRole('button')
      .find((button) => button.textContent?.startsWith('var.digest_to')) as HTMLElement
    fireEvent.click(row)
    // Landed at the caret, and nothing was spliced away.
    expect(onCommit).toHaveBeenCalledWith('!{{ var.digest_to }}Hi {{ s2.count }} there')
  })

  /* Outside a hole there is nothing to retarget, so a double-click is what the
     platform makes of it — selecting a word. */
  it('leaves a double-click in the surrounding text alone', () => {
    const { field } = mount({ value: 'Hi {{ s2.count }} there' })
    fireEvent.focus(field)
    fireEvent.click(field, { target: { selectionStart: 1 } })
    const event = fireEvent.mouseDown(field, { detail: 2 })
    expect(event).toBe(true)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  /* Opened any other way, the choice lands at the caret and the hole beside it
     is untouched. */
  it('does not replace anything when the picker was opened from the button', () => {
    const { field, onCommit } = mount({ value: '{{ s2.count }} ' })
    fireEvent.focus(field)
    fireEvent.click(field, { target: { selectionStart: 15 } })
    fireEvent.click(screen.getByRole('button', { name: 'Insert into To' }))
    const row = screen
      .getAllByRole('button')
      .find((button) => button.textContent?.startsWith('var.digest_to')) as HTMLElement
    fireEvent.click(row)
    expect(onCommit).toHaveBeenCalledWith('{{ s2.count }} {{ var.digest_to }}')
  })
})
