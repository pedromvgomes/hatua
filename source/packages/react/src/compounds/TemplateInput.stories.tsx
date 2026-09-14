import type { ScopeEntry } from '@hatua/model'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, useRef, useState } from 'react'
import { TemplateInput, type TemplateInputProps } from './TemplateInput'

/**
 * The Template input, in every state it has.
 *
 * Each story is rendered twice, once per pinned colour mode — see
 * `.storybook/preview.tsx`. Two panels rather than a toolbar switch, because
 * the dark palette is a separate declaration block that can drift from the
 * light one without anything failing.
 *
 * The surfaces that only exist while somebody is mid-keystroke — the completion
 * list, the picker, the signature strip — are opened by `Driven` below, which
 * dispatches the same events a keyboard would. No interaction addon: this
 * package deliberately has none, and a story that has to be poked before it
 * shows anything is a story nobody looks at.
 */
const SCOPE: ScopeEntry[] = [
  {
    path: 'run.id',
    kind: 'context',
    label: 'Run id',
    description: 'Identifies this execution in the run history.',
    type: { type: 'text' },
  },
  {
    path: 'run.started_at',
    kind: 'context',
    label: 'Started at',
    description: 'When this execution began.',
    type: { type: 'datetime' },
  },
  { path: 'var.digest_to', kind: 'var', label: 'digest_to', type: { type: 'text' } },
  {
    path: 'triggers.nightly',
    kind: 'trigger',
    label: 'Weekday mornings',
    type: { type: 'object', members: { triggered_at: { type: 'datetime' } } },
  },
  {
    path: 'steps.s2',
    kind: 'step',
    label: 'Fetch emails',
    type: {
      type: 'object',
      members: {
        count: { type: 'number' },
        messages: {
          type: 'list',
          members: { subject: { type: 'text' }, received_at: { type: 'datetime' } },
        },
      },
    },
  },
]

/** Typing, as the platform does it: the native setter, then the event React listens for. */
const typeInto = (input: HTMLInputElement, text: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, text)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

type Route =
  | 'typing'
  | 'shortcut-inside'
  | 'shortcut-outside'
  | 'button'
  | 'caret'
  | 'focus'
  | 'retarget'

/**
 * Opens one of the surfaces the way a user would reach it, once, after mount.
 *
 * The four ways in are the point of several of these stories, so they are
 * reached rather than simulated: the same keydown, the same click, the same
 * `input` event.
 */
function Driven({
  route,
  caret,
  openTab,
  ...props
}: TemplateInputProps & { route?: Route; caret?: number; openTab?: string }) {
  const host = useRef<HTMLDivElement>(null)
  const [value, setValue] = useState(props.value)

  useEffect(() => {
    const input = host.current?.querySelector('input, textarea') as HTMLInputElement | null
    if (!input || !route) return

    /*
     * Deliberately no `focus()`.
     *
     * Each story is rendered twice, once per colour mode, and only one element
     * in a document can hold focus — so focusing here means the second panel
     * takes it from the first, the first blurs, and its popup closes. Nothing
     * below needs focus: a selection can be set on an unfocused input, and an
     * open popup is itself what puts the characters and the caret marker in the
     * mirror.
     */
    if (caret !== undefined) input.setSelectionRange(caret, caret)

    if (route === 'typing') {
      typeInto(input, props.value)
      return
    }
    if (route === 'shortcut-inside' || route === 'shortcut-outside') {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', ctrlKey: true, bubbles: true }))
      return
    }
    if (route === 'caret') {
      input.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      return
    }
    if (route === 'focus') {
      input.focus()
      return
    }
    if (route === 'retarget') {
      // The second click on a hole, which is what opens the picker over it.
      input.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      input.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, detail: 2 }))
      return
    }
    const spark = host.current?.querySelector('button')
    spark?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  }, [route, caret, props.value])

  useEffect(() => {
    if (!openTab) return
    // A frame later, because the effect that opens the picker runs in the same
    // pass as this one and the tabs are not in the DOM until React has
    // rendered what it set.
    //
    // The picker renders inside the widget's own subtree, so its tabs are
    // reachable from the host without going to the document.
    const frame = requestAnimationFrame(() => {
      for (const button of host.current?.querySelectorAll('button') ?? []) {
        if (button.getAttribute('role') === 'tab' && button.textContent === openTab) {
          button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        }
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [openTab])

  return (
    <div ref={host} style={{ maxWidth: 372 }}>
      <TemplateInput {...props} value={value} onCommit={setValue} />
    </div>
  )
}

const meta = {
  title: 'Compounds/TemplateInput',
  component: Driven,
  args: { label: 'To', scope: SCOPE, value: '', onCommit: () => {} },
} satisfies Meta<typeof Driven>

export default meta
type Story = StoryObj<typeof meta>

/** Nothing written yet. The placeholder is the field's, not the widget's. */
export const Empty: Story = {
  args: { placeholder: 'Someone to send it to', expectedType: 'text' },
}

/**
 * A hole that is the whole value. `resolve()` keeps the expression's own type
 * here — the number 24, not the string "24".
 */
export const WholeValueReference: Story = {
  args: { value: '{{ var.digest_to }}', expectedType: 'text' },
}

/**
 * At rest, a Reference is drawn as what it names. There is no caret to keep
 * aligned, so the mirror is free to be a different width from the input behind
 * it — which is exactly what showing a label instead of a path requires.
 */
export const MixedText: Story = {
  args: {
    value: 'Inbox digest · {{ steps.s2.count }} messages for {{ run.id }}',
    expectedType: 'text',
  },
}

/**
 * The same value with the field focused: the characters come back, braces and
 * all, because the text is the editing surface whenever anyone is editing.
 *
 * The one story that genuinely needs focus, so only one of the two panels can
 * show it — the other stays at rest, which is the comparison anyway.
 */
export const MixedTextWhileEditing: Story = {
  args: {
    value: 'Inbox digest · {{ steps.s2.count }} messages for {{ run.id }}',
    expectedType: 'text',
    route: 'focus',
  },
}

/**
 * The four kinds side by side, which is the only way to judge the marks against
 * each other. A chip carrying only a label loses the half that says where the
 * value came from — two of these would otherwise read as "digest_to" and
 * "count" and say nothing at all.
 */
export const EveryKindOfSource: Story = {
  args: {
    value:
      '{{ steps.s2.count }} · {{ triggers.nightly.triggered_at }} · {{ var.digest_to }} · {{ run.id }}',
    expectedType: 'text',
  },
}

/**
 * Every hole that parsed is a chip; what differs is what the chip can say.
 *
 * A Reference names one value, so it carries that value's mark and source.
 * Anything computed has no single source to name and shows its own text —
 * as does a Reference whose path has gone stale, where the missing source is
 * the signal. A hole that does not parse at all keeps its characters, because
 * they are the only thing that can be edited back into shape.
 */
export const NotEveryChipIsAReference: Story = {
  args: {
    value: '{{ steps.s2.count + 1 }} · {{ steps.s9.gone }} · {{ steps.s2. + }}',
    expectedType: 'text',
  },
}

/** The ordinary state of a Template halfway through being typed. */
export const UnclosedHole: Story = {
  args: { value: 'Inbox digest · {{ s2.co', expectedType: 'text' },
}

/** The field has an issue; the border says so and the text stays editable. */
export const WithAnIssue: Story = {
  args: { value: '{{ steps.s9.missing }}', expectedType: 'text', invalid: true },
}

/** 76px, for a `textarea` field. */
export const Multiline: Story = {
  args: {
    multiline: true,
    value: 'Hello {{ triggers.nightly.triggered_at }},\n\nYou have {{ steps.s2.count }} messages.',
    expectedType: 'text',
  },
}

/**
 * The active parameter is the comma count at depth zero, and the strip carries
 * the parameter's own sentence — which is what `ParamSpec.description` is for.
 */
export const CallWithSignatureHelp: Story = {
  args: { value: '{{ dt.add(run.started_at, 2, ', expectedType: 'datetime', route: 'caret' },
}

/** Way in #1: typing `{{`. The hole closes itself and the list opens. */
export const CompletionByTyping: Story = {
  args: { value: '{{', expectedType: 'text', route: 'typing' },
}

/** Way in #2: `Ctrl`+`Space` inside a hole. */
export const CompletionByShortcut: Story = {
  args: { value: '{{ steps.s2. }}', expectedType: 'text', route: 'shortcut-inside', caret: 12 },
}

/** After a namespace's dot: that namespace's Functions, and no scope at all. */
export const CompletionAfterANamespace: Story = {
  args: { value: '{{ dt. }}', expectedType: 'datetime', route: 'shortcut-inside', caret: 6 },
}

/**
 * A list has no members — its elements do. Two rows: the whole list, and `[]`,
 * which is navigable further.
 */
export const CompletionThroughAProjection: Story = {
  args: {
    value: '{{ steps.s2.messages[]. }}',
    expectedType: 'text',
    route: 'shortcut-inside',
    caret: 23,
  },
}

/**
 * Way in #5: a second click on a hole opens the picker scoped to it, and
 * whatever is chosen **replaces** it — the one gesture that retargets an
 * existing Reference in a single go.
 */
export const RetargetByDoubleClick: Story = {
  args: {
    value: 'Inbox digest · {{ steps.s2.count }} messages',
    expectedType: 'text',
    route: 'retarget',
    caret: 28,
  },
}

/** Way in #3: `Ctrl`+`Space` outside a hole opens the browsable surface instead. */
export const PickerByShortcut: Story = {
  args: { value: 'Inbox digest · ', expectedType: 'text', route: 'shortcut-outside', caret: 15 },
}

/** Way in #4: the ⚡ button, which is Tab-reachable so a swallowed shortcut locks nobody out. */
export const PickerReferenceTab: Story = {
  args: { value: '', expectedType: 'text', route: 'button' },
}

/** The other tab: the two shapes an Expression can take. */
export const PickerFunctionTab: Story = {
  args: { value: '', expectedType: 'datetime', route: 'button', openTab: 'Function' },
}

/**
 * Every row that produces what the field declares takes the green rail. Here
 * the field is `datetime`, so the Run Context instant fits and the text does
 * not.
 */
export const TypeMarkingMatching: Story = {
  args: { value: '{{ run. }}', expectedType: 'datetime', route: 'shortcut-inside', caret: 7 },
}

/**
 * The same rows against a `number` field: nothing fits, and **nothing is marked
 * wrong** either. Neutral covers "does not fit" and "cannot be judged" alike.
 */
export const TypeMarkingConflicting: Story = {
  args: { value: '{{ run. }}', expectedType: 'number', route: 'shortcut-inside', caret: 7 },
}

/**
 * The same hole inside a sentence, against the same `number` field. ADR-0009
 * keeps interpolation soft, so a hole in mixed text has only to render — and
 * the rows that were neutral above are marked here.
 */
export const TypeMarkingInsideMixedText: Story = {
  args: {
    value: 'Started {{ run. }}',
    expectedType: 'number',
    route: 'shortcut-inside',
    caret: 15,
  },
}

/**
 * A workflow variable: no type marking at all, because `varType` reads a
 * variable's type *from* its value and there is nothing to check it against.
 */
export const NoDeclaredType: Story = {
  args: { value: '{{ run. }}', route: 'shortcut-inside', caret: 7 },
}
