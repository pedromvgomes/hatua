import {
  CORE_FUNCTIONS,
  type FunctionSpec,
  referencePath,
  type ValueType,
} from '@hatua/expressions'
import type { ScopeEntry } from '@hatua/model'
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { cx } from '../primitives/classNames'
import { Tooltip } from '../primitives/Tooltip'
import { useOverflowing } from '../primitives/useOverflowing'
import { CompletionList, rowId } from './CompletionList'
import {
  type Candidate,
  type ChipParts,
  chipFor,
  completionsAt,
  expressionChip,
  ghostFor,
} from './candidates'
import { ExpressionPicker } from './ExpressionPicker'
import {
  caretContext,
  droppedPath,
  dropReference,
  expectedAt,
  expressionEnd,
  insertCandidate,
  replaceHole,
  spliceAt,
} from './insertion'
import styles from './TemplateInput.module.css'
import css from './TemplateInput.module.css?inline'
import { type HoleSpan, templateShape } from './templateSpans'

/**
 * The Template input: one widget for every site that holds a Template.
 *
 * A Step's mappable `with:` fields, a Branch's `when`, and a workflow
 * variable's value are three places and one editor. Building half of it in one
 * of them is how the three end up disagreeing about what `{{` does.
 *
 * ## The text is the editing surface
 *
 * `{{ … }}` is highlighted **in place** — never replaced by a widget you cannot
 * type through. A token you have to delete and re-add to fix one character makes
 * an existing Template harder to edit than to write, and the same reasoning is
 * what makes the inserter's one-way street acceptable: editing an existing call
 * means editing text, and the text is always there.
 *
 * The highlight is painted by a mirror behind a transparent input rather than
 * by a contenteditable. A contenteditable owns its own DOM, so every keystroke
 * becomes a diff against markup the browser rewrote, and the caret belongs to
 * nobody. An `<input>` keeps the platform's caret, selection, undo, IME and
 * autofill behaviour, and the mirror is a read-only copy that never has to be
 * right about anything except where the characters are.
 *
 * ## Four ways in, one set of candidates
 *
 * Typing `{{` and `Ctrl`+`Space` inside a hole open the compact list; the same
 * chord outside one, and the ⚡ button, open the picker. **Completion follows
 * typing, never caret placement** — clicking into a hole to fix a character
 * must not bury the field under a popup.
 *
 * `Ctrl` alone, not `Cmd`: `Cmd+Space` is Spotlight and `Ctrl+Cmd+Space` is the
 * Emoji picker, and neither ever reaches the page on a Mac. It is an
 * accelerator and never the only route — ⚡ is Tab-reachable, so a Host page or
 * an OS swallowing the shortcut locks nobody out.
 *
 * ## Props in, events out
 *
 * Scope, the declared type and the Functions arrive as props; this reads no
 * store and fetches nothing. That is what lets the same input serve a
 * variable's value, a Trigger's field and a Step's field without knowing which
 * it is in.
 */
export interface TemplateInputProps {
  value: string
  /**
   * Called with the settled value, not with every keystroke.
   *
   * Controlled from the document it would fight the user: every keystroke is a
   * command, a command is a write, and a write re-parses — so the caret jumps
   * to the end on every letter.
   */
  onCommit: (next: string) => void
  /** What a screen reader calls the field. */
  label: string
  /** Everything this Template may read. */
  scope: readonly ScopeEntry[]
  /**
   * The type the field declares, and what the left rail judges against.
   *
   * Optional because a caller may hold a Template nothing declares a type for,
   * and then no row is ever marked. There is nothing to check against, and a
   * rail that is always neutral is at least honest.
   */
  expectedType?: ValueType
  /**
   * A `ref` field: it holds exactly one Reference, so a drop replaces the value
   * rather than appending to it.
   */
  single?: boolean
  multiline?: boolean
  placeholder?: string
  /** The field has an issue; the border says so. */
  invalid?: boolean
  id?: string
}

type OpenSurface = 'none' | 'completion' | 'picker'

/** Matches the picker panel's `inline-size`; right-aligning to the ⚡ needs it as a number. */
const PANEL = 392

export function TemplateInput({
  value,
  onCommit,
  label,
  scope,
  expectedType,
  single = false,
  multiline = false,
  placeholder,
  invalid = false,
  id,
}: TemplateInputProps) {
  const listId = useId()
  const wrap = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const spark = useRef<HTMLButtonElement>(null)
  const field = useRef<HTMLInputElement & HTMLTextAreaElement>(null)
  /** The tooltip's copy anchors nothing, so its marker ref goes nowhere. */
  const unanchored = useRef<HTMLSpanElement>(null)
  const mirror = useRef<HTMLDivElement>(null)
  const caretMark = useRef<HTMLSpanElement>(null)

  const [draft, setDraft] = useState(value)
  const [committed, setCommitted] = useState(value)
  const [caret, setCaret] = useState(0)
  const [open, setOpen] = useState<OpenSurface>('none')
  const [active, setActive] = useState(0)
  const [at, setAt] = useState({ left: 0, top: 0 })
  /**
   * Whether `at` has been measured yet. A popup drawn before it has is a popup
   * in the corner of the window for one frame.
   */
  const [placed, setPlaced] = useState(false)

  const [anchor, setAnchor] = useState({ left: 0, top: 0, bottom: 0 })
  const [focused, setFocused] = useState(false)
  /**
   * Where the hole a double-click named begins, which the next choice replaces
   * outright. Null for every other way into the picker, where the choice lands
   * at the caret instead.
   *
   * An offset rather than the span, because the span goes stale: the picker
   * does not take the focus, so the text can be edited from under it, and a
   * range captured before that lands somewhere else entirely. This is looked up
   * again against the current shape at the moment it is used.
   */
  const [replacing, setReplacing] = useState<number | null>(null)
  /**
   * What the picker is hanging off.
   *
   * The caret moves, so a picker opened from it re-measures; the ⚡ button does
   * not, and re-measuring from the caret was quietly throwing its position away
   * — the panel is right-aligned to that button so it hangs under the field
   * rather than off the side of a 304px column.
   */
  const [anchoredTo, setAnchoredTo] = useState<'caret' | 'button'>('caret')

  /**
   * The ⚡ button's rect, with the panel right-aligned to it: the button sits at
   * the field's trailing edge, so the panel hangs under the field rather than
   * off the side of the 304px column it lives in.
   */
  const sparkRect = useCallback(() => {
    const button = spark.current?.getBoundingClientRect()
    return button && { left: button.right - PANEL, top: button.top, bottom: button.bottom }
  }, [])
  /**
   * Escape means "not now", and it has to outlast the keystroke that follows.
   * Cleared when the caret leaves the hole, or by asking for the list again.
   */
  const [dismissed, setDismissed] = useState(false)
  const pending = useRef<number | null>(null)

  // Set during render rather than in an effect: an effect paints the stale
  // value first, so an undo flashes the old text before correcting itself.
  if (value !== committed) {
    setCommitted(value)
    setDraft(value)
  }

  const shape = useMemo(() => templateShape(draft), [draft])

  /*
   * A single-line field holds one line and scrolls, and at rest nothing has the
   * focus that would let anyone scroll it — so a long value has most of itself
   * out of reach with no way in. The tooltip is that way in.
   *
   * Measured on the mirror rather than on the input, because the mirror is what
   * is on screen: chips are wider than the characters they stand for, so the
   * value that fits and the value that reads are not the same value.
   */
  const overflowing = useOverflowing(mirror)
  const context = useMemo(() => caretContext(draft, caret), [draft, caret])
  const candidates = useMemo(
    () => (open === 'completion' ? completionsAt(context.prefix, scope) : []),
    [open, context.prefix, scope],
  )
  const ghost = open === 'completion' ? ghostFor(context.prefix, candidates) : ''
  const expected = expectedAt(
    draft,
    context.hole?.start ?? caret,
    context.hole?.end ?? caret,
    expectedType,
  )
  const signature = useMemo(
    () => signatureAt(draft, caret, context.hole?.start),
    [draft, caret, context.hole?.start],
  )

  // Clamped rather than trusted: the list rebuilds on every keystroke, and a
  // selection that outran it would leave `aria-activedescendant` naming a row
  // that is not in the DOM.
  const selected = candidates.length === 0 ? -1 : Math.min(active, candidates.length - 1)

  useLayoutEffect(() => {
    const to = pending.current
    if (to === null) return
    pending.current = null
    field.current?.focus()
    field.current?.setSelectionRange(to, to)
  })

  /**
   * Where the popups sit.
   *
   * Published only when it has actually moved: a fresh object per render would
   * be new state per render for ever.
   */
  const measure = useCallback(() => {
    const rect = caretMark.current?.getBoundingClientRect()
    const field = box.current?.getBoundingClientRect()
    if (!rect || !field) return

    const list = { left: rect.left, top: rect.bottom + 4 }
    setAt((current) => (current.left === list.left && current.top === list.top ? current : list))
    setPlaced(true)

    /*
     * The picker anchors across to whatever it was hung from, and down to the
     * whole field: it is tall, and one starting mid-field would cover the text
     * it is being used to write.
     */
    const from = anchoredTo === 'button' ? sparkRect() : rect
    if (!from) return
    const panel = { left: from.left, top: from.top, bottom: field.bottom }
    setAnchor((current) =>
      current.left === panel.left && current.top === panel.top && current.bottom === panel.bottom
        ? current
        : panel,
    )
  }, [anchoredTo, sparkRect])

  /*
   * After every render, because the marker moves with every keystroke and every
   * arrow key and there is no value to name that in a dependency list.
   */
  useLayoutEffect(() => {
    if (open !== 'none') measure()
  })

  /*
   * And when the field moves without re-rendering at all.
   *
   * A popup is a fixed-position layer holding viewport coordinates, so a Host
   * scrolling its own page — or the window being resized — leaves it where the
   * field used to be, and nothing about React notices. Captured, so an ancestor
   * scrolling counts and not only the window: every one of these fields lives
   * in a panel that scrolls.
   */
  useEffect(() => {
    if (open === 'none') return
    window.addEventListener('scroll', measure, true)
    window.addEventListener('resize', measure)
    return () => {
      window.removeEventListener('scroll', measure, true)
      window.removeEventListener('resize', measure)
    }
  }, [open, measure])

  const commit = (next: string) => {
    if (next === committed) return
    setCommitted(next)
    onCommit(next)
  }

  const track = (element: HTMLInputElement | HTMLTextAreaElement) =>
    setCaret(element.selectionStart ?? element.value.length)

  const write = ({ value: next, caret: to }: { value: string; caret: number }) => {
    setDraft(next)
    setCaret(to)
    // Setting a controlled input's value puts the caret at the end, so a
    // programmatic write has to put it back. Recorded here and applied in a
    // layout effect below, because it has to happen after React has written the
    // value and before the browser paints — set now, it would be overwritten by
    // the very render this schedules.
    pending.current = to
  }

  const accept = (candidate: Candidate) => {
    const edit = insertCandidate(draft, context, caret, candidate.insert)
    write(edit)
    // A namespace or an open paren is mid-expression: the list stays up because
    // the next thing typed is what it is for.
    setOpen(candidate.insert.endsWith('.') ? 'completion' : 'none')
    setActive(0)
  }

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const element = event.currentTarget

    if (event.key === ' ' && event.ctrlKey) {
      event.preventDefault()
      const inside = caretContext(draft, element.selectionStart ?? 0).hole !== null
      setCaret(element.selectionStart ?? 0)
      setDismissed(false)
      setReplacing(null)
      setAnchoredTo('caret')
      setOpen(inside ? 'completion' : 'picker')
      setActive(0)
      return
    }

    if (open === 'completion' && candidates.length > 0) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        // From `selected`, not from `active`: the list rebuilds on every
        // keystroke and `active` may be pointing past the end of it, in which
        // case wrapping off that stale index lands back where the highlight
        // already is and the arrow key does nothing.
        const step = event.key === 'ArrowDown' ? 1 : -1
        setActive((selected + step + candidates.length) % candidates.length)
        return
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        // `Tab` accepts only while the list is open, and otherwise falls
        // through to focus movement: Hatua is a guest in someone's page and
        // cannot trap focus.
        event.preventDefault()
        const candidate = candidates[selected]
        if (candidate) accept(candidate)
        return
      }
      if (event.key === 'ArrowRight' && ghost && element.selectionStart === draft.length) {
        event.preventDefault()
        write(spliceAt(draft, caret, caret, ghost))
        return
      }
    }

    /*
     * Typing the closing brace steps over the one already there.
     *
     * The `{{` was closed on the user's behalf, so the caret sits three
     * characters inside `{{ | }}` and walking out of it meant pressing the
     * arrow key three times. Type-over is what every editor that auto-closes a
     * bracket does about that, and it is one keystroke — the same keystroke
     * somebody would have pressed anyway to close the hole themselves.
     *
     * The whole ` }}` in one press, not a brace at a time: the space is ours
     * too, and leaving the caret in the middle of a closer nobody typed is the
     * fiddliness this exists to remove.
     */
    if (event.key === '}') {
      const from = element.selectionStart ?? 0
      const closer = /^\s*\}\}/.exec(draft.slice(from))
      if (closer && caretContext(draft, from).hole) {
        event.preventDefault()
        write({ value: draft, caret: from + closer[0].length })
        setOpen('none')
        return
      }
    }

    if (event.key === 'Escape') {
      if (open !== 'none') {
        event.preventDefault()
        setDismissed(true)
        setOpen('none')
        return
      }
      setDraft(committed)
      return
    }

    if (event.key === 'Enter' && !multiline) commit(element.value)
  }

  const onChange = (element: HTMLInputElement | HTMLTextAreaElement) => {
    const next = element.value
    const to = element.selectionStart ?? next.length

    /*
     * A `{{` is a hole and nothing else, so it is closed on the user's behalf
     * with the caret left between. Left open, every completion accepted into it
     * lands in text that does not parse — so the highlight stays off and the
     * checker has nothing to say until two more characters are typed by hand.
     *
     * Only when a brace was just TYPED, which is what `grew` is for. Asked of
     * the two characters before the caret alone, it fires on the way out as
     * well as on the way in: backspacing through `{{ steps.s2.count }}` reaches a
     * caret sitting just after a `{{`, and every further backspace added
     * another `}}` — `{{ steps.s2.count }}{{  }} }} }} }}`.
     *
     * One character, not two or more: a pasted `{{ x }}` is already closed, and
     * closing it again would be the same fault with a different trigger.
     */
    const grew = next.length === draft.length + 1
    if (grew && to >= 2 && next.slice(to - 2, to) === '{{') {
      write(spliceAt(next, to, to, '  }}', 1))
      setDismissed(false)
      setOpen('completion')
      setActive(0)
      return
    }

    setDraft(next)
    setCaret(to)
    // Typing is a change of mind: whatever a double-click named is not what is
    // being edited any more.
    setReplacing(null)

    /*
     * **Completion follows typing, never caret placement.** Clicking into a
     * hole to fix a character must not bury the field under a popup — but
     * editing the characters IS typing, whichever key does it. Offering the
     * list only on `{{` left someone who deleted their way back to `{{ var. }}`
     * with no completion at all, in the one place they most obviously wanted
     * some.
     */
    const inside = caretContext(next, to).hole !== null
    if (!inside) {
      setDismissed(false)
      if (open === 'completion') setOpen('none')
      return
    }
    if (!dismissed) {
      setOpen('completion')
      setActive(0)
    }
  }

  const Field = multiline ? 'textarea' : 'input'

  return (
    <>
      <style href="hatua-template-input" precedence="hatua">
        {css}
      </style>
      <div className={styles.wrap} ref={wrap}>
        <div
          ref={box}
          className={cx(styles.box, multiline && styles.tall, invalid && styles.invalid)}
          /*
           * At rest the mirror shows different characters from the ones the
           * `<input>` behind it holds, so the offset the browser derives from
           * the pointer is measured against text nobody can see: click the word
           * after a chip and the caret lands inside the hole. Claimed here and
           * translated through what is actually visible.
           *
           * Capture, because the input paints over the mirror and would
           * otherwise have set its own caret by the time this ran.
           */
          onMouseDownCapture={(event) => {
            /*
             * A second click on a hole retargets it: the picker opens scoped to
             * that hole, and whatever is chosen replaces it.
             *
             * Read from the caret rather than from the pointer, because the
             * first click has already put it inside the hole — and at rest that
             * first click also swapped the chips for characters, so the pointer
             * is now over different text than it was aimed at.
             */
            if (event.detail >= 2) {
              const at = field.current?.selectionStart ?? caret
              /*
               * A hole that PARSED, which is a stricter thing than one with a
               * `}}` after it. Both `caretContext` and the scanner pair an
               * opening brace with the next closer anywhere, so a stray `{{`
               * swallows the hole after it — and replacing that span takes the
               * good hole and the prose between them away. Reading it is the
               * same condition a chip is drawn under, which is the right one:
               * retargeting something nobody can read means nothing.
               */
              const hole = shape.holes.find(
                (candidate) => candidate.expr && at >= candidate.start && at <= candidate.end,
              )
              if (!hole) return
              event.preventDefault()
              setReplacing(hole.start)
              setAnchoredTo('caret')
              setDismissed(false)
              setOpen('picker')
              return
            }

            // Only at rest: with the characters back the input's own hit-testing
            // is measuring the text that is actually on screen, and the platform
            // does it better than this can.
            if (focused) return
            const at = offsetAtPoint(
              mirror.current,
              field.current,
              draft,
              shape.holes,
              event.clientX,
              event.clientY,
            )
            if (at === null) return
            event.preventDefault()
            write({ value: draft, caret: at })
          }}
        >
          {/*
            The mirror. `aria-hidden` because it is the same characters twice:
            a screen reader reads the input, and this exists only so the holes
            can be painted where they actually sit.
          */}
          <div
            className={cx(styles.mirror, multiline && styles.tall)}
            ref={mirror}
            aria-hidden="true"
          >
            {paint({
              value: draft,
              shape,
              caret,
              ghost,
              mark: caretMark,
              scope,
              /*
               * At rest there is no caret to keep aligned, so a hole that names
               * one value may be drawn as what it is rather than as how it is
               * spelled. See `chipOf`.
               *
               * An open popup counts as editing whether or not the field still
               * holds the focus — the picker takes it into its own controls.
               * Both are anchored to this field and are being used to write
               * into it, so the characters they will land among have to be the
               * ones on screen. It is also what puts a caret marker in the
               * mirror, which is the only thing either of them can be
               * positioned against.
               */
              chip: focused || open !== 'none' ? null : (path) => chipFor(path, scope),
            })}
            {/* A trailing newline collapses in a block box, so the mirror comes
                up one line short of the textarea it is behind. */}
            {'​'}
          </div>

          <Field
            id={id}
            ref={field}
            className={cx(styles.field, multiline && styles.tall)}
            value={draft}
            rows={multiline ? 3 : undefined}
            placeholder={placeholder}
            spellCheck={false}
            aria-label={label}
            aria-invalid={invalid || undefined}
            role="combobox"
            aria-autocomplete="both"
            aria-expanded={open === 'completion'}
            aria-controls={open === 'completion' ? listId : undefined}
            aria-activedescendant={
              open === 'completion' && selected >= 0 ? rowId(listId, selected) : undefined
            }
            onChange={(event) => onChange(event.currentTarget)}
            onKeyUp={(event) => track(event.currentTarget)}
            onClick={(event) => track(event.currentTarget)}
            onKeyDown={onKeyDown}
            onFocus={() => setFocused(true)}
            onBlur={(event) => {
              setFocused(false)
              setPlaced(false)
              /*
               * The completion list belongs to the caret, so it goes when the
               * caret does — unless focus merely moved within this widget,
               * which is what happens when a row is taken or the picker's own
               * controls are used.
               */
              if (!wrap.current?.contains(event.relatedTarget)) setOpen('none')
              commit(event.currentTarget.value)
            }}
            onScroll={(event) => {
              // The mirror has to follow, or the highlight slides off the text
              // the moment the value is longer than the box.
              if (mirror.current) mirror.current.scrollLeft = event.currentTarget.scrollLeft
            }}
            onDragOver={(event) => {
              if (!droppedPath(event.dataTransfer)) return
              event.preventDefault()
              event.dataTransfer.dropEffect = 'copy'
            }}
            onDrop={(event) => {
              const path = droppedPath(event.dataTransfer)
              if (!path) return
              event.preventDefault()
              const to = event.currentTarget.selectionStart ?? draft.length
              const edit = dropReference(draft, to, to, path, { replace: single })
              write(edit)
              commit(edit.value)
            }}
          />

          <button
            type="button"
            className={styles.spark}
            aria-label={`Insert into ${label}`}
            ref={spark}
            onClick={() => {
              setAnchoredTo('button')
              setReplacing(null)
              setOpen('picker')
            }}
          >
            <svg viewBox="0 0 16 16" width="14" height="14" focusable="false" aria-hidden="true">
              <path d="M9 1.5 3.5 9h4l-.5 5.5L12.5 7h-4z" />
            </svg>
          </button>
        </div>

        {signature ? <SignatureHelp spec={signature.spec} active={signature.active} /> : null}

        {/*
          The same rendering, given room to wrap. Re-describing it as raw text
          would answer a different question from the one the chips were asked:
          what this value IS, in the words the chips already use.
        */}
        <Tooltip
          anchor={box}
          enabled={overflowing && !focused}
          content={
            <span className={styles.full}>
              {paint({
                value: draft,
                shape,
                caret: -1,
                ghost: '',
                mark: unanchored,
                scope,
                chip: (path) => chipFor(path, scope),
              })}
            </span>
          }
        />
      </div>

      {open === 'completion' && placed && candidates.length > 0 ? (
        <CompletionList
          id={listId}
          candidates={candidates}
          active={Math.max(selected, 0)}
          matched={context.prefix.length}
          expected={expected}
          onPick={accept}
          onActive={setActive}
          at={at}
        />
      ) : null}

      {open === 'picker' && placed ? (
        <ExpressionPicker
          scope={scope}
          expected={expected}
          anchor={anchor}
          onClose={() => {
            setReplacing(null)
            setOpen('none')
          }}
          onChoose={(insert) => {
            /*
             * Scoped to a hole, the choice takes its place; opened any other
             * way, it lands at the caret.
             *
             * Looked up again rather than trusted: the picker holds no focus,
             * so the text may have moved since the gesture that named it. A
             * hole that is no longer there is no longer the target.
             */
            const hole =
              replacing === null
                ? undefined
                : shape.holes.find((candidate) => candidate.expr && candidate.start === replacing)
            const edit = hole
              ? replaceHole(draft, hole, insert)
              : insertCandidate(draft, context, caret, insert)
            write(edit)
            commit(edit.value)
            setReplacing(null)
            setOpen('none')
          }}
        />
      ) : null}
    </>
  )
}

/**
 * The value, split into text and holes, with a zero-width marker where the
 * caret is.
 *
 * The marker is what the completion list and the picker are anchored to.
 * Measuring a caret inside an `<input>` has no API; measuring a span in a box
 * with the same font, padding and wrapping does, and the mirror already exists.
 */
interface Piece {
  text: string
  start: number
  className?: string
  /** A `{{` with nothing closing it: three runs become two. */
  unclosed?: boolean
  /** Set when this hole is drawn as a chip instead of as its own characters. */
  chip?: ChipParts
}

/**
 * One stretch of text drawn as itself, carrying the offset it begins at.
 *
 * A hole is three of these — `{{`, the expression, `}}` — because the
 * delimiters are how a Template spells a hole rather than part of what it
 * names, and they step back so the path can read. The piece that owns the three
 * colours them; nothing draws a box, because while the characters are showing
 * this field marks syntax the way an editor does.
 *
 * Every run carries `data-at`, and that is not decoration: `offsetAtPoint`
 * translates a click into an offset by finding the run under it and adding the
 * offset within its text. A run whose text node does not begin where `data-at`
 * says would put the caret in the wrong place.
 */
interface Run {
  text: string
  start: number
  className?: string
}

function runsOf(piece: Piece): Run[] {
  if (!piece.className) return [{ text: piece.text, start: piece.start }]

  const close = piece.unclosed ? 0 : 2
  const body = piece.text.slice(2, piece.text.length - close)
  return [
    { text: piece.text.slice(0, 2), start: piece.start, className: styles.brace },
    ...(body ? [{ text: body, start: piece.start + 2 }] : []),
    ...(close
      ? [
          {
            text: piece.text.slice(piece.text.length - close),
            start: piece.start + 2 + body.length,
            className: styles.brace,
          },
        ]
      : []),
  ]
}

/**
 * How a hole is drawn when the field is at rest.
 *
 * **Every hole that parsed becomes a chip.** A hole is a hole whether or not it
 * names one value, and one drawn as bare text among the words around it is the
 * only thing on the line that does not look like what it is.
 *
 * What differs is what the chip can say. A **Reference** — which
 * `isReference()` answers from the parsed shape, because a Reference is a shape
 * and not a syntax — names exactly one value, so its chip carries that value's
 * source and its own mark. Anything else computes, and `{{ steps.s2.count + 1 }}` has
 * no single source to name, so its chip shows its own text. A Reference whose
 * path has gone stale falls to the same treatment, which is what keeps the path
 * the checker will name on screen.
 *
 * A hole that did NOT parse gets no chip at all: its characters are the only
 * thing that can be edited back into shape, so they stay.
 */
function chipOf(
  hole: HoleSpan,
  value: string,
  scope: readonly ScopeEntry[],
  chip: ((path: string) => ChipParts | null) | null,
): ChipParts | undefined {
  if (!chip || !hole.expr) return undefined

  const path = referencePath(hole.expr)
  const named = path ? chip(path) : null
  if (named) return named

  // The hole minus its delimiters and the space a writer left inside them: the
  // chip supplies its own padding, and carrying theirs as well shows as a gap
  // the eye reads as part of the value.
  let from = hole.start + 2
  let to = hole.end - 2
  while (from < to && /\s/.test(value[from] as string)) from++
  while (to > from && /\s/.test(value[to - 1] as string)) to--

  return { of: 'expression', parts: expressionChip(value, hole.expr, from, to, scope) }
}

/**
 * The value, split into text and holes, with a zero-width marker where the
 * caret is and the ghost text beside it.
 *
 * The marker is what the completion list and the picker are anchored to.
 * Measuring a caret inside an `<input>` has no API; measuring a span in a box
 * with the same font, padding and wrapping does, and the mirror already exists.
 *
 * **The marker and the ghost go INSIDE the run they fall in.** A ghost appended
 * after the runs completes `{{ ru }}` as `{{ ru }}n` — outside the hole it
 * belongs to, after the closing braces, in the place the eye least expects it.
 * A marker seated between two siblings splits whatever is drawn around them,
 * which is how a chip ends up with a seam down its middle.
 */
function paint({
  value,
  shape,
  caret,
  ghost,
  mark,
  scope,
  chip,
}: {
  value: string
  shape: ReturnType<typeof templateShape>
  caret: number
  ghost: string
  mark: React.RefObject<HTMLSpanElement | null>
  /** Read to name the References inside a computed hole. */
  scope: readonly ScopeEntry[]
  /** What to call a Reference at rest, or null while the field has focus. */
  chip: ((path: string) => ChipParts | null) | null
}) {
  const pieces: Piece[] = []
  let at = 0

  for (const hole of [...shape.holes, ...(shape.unclosed ? [shape.unclosed] : [])]) {
    /*
     * A hole nobody can read takes the wavy underline — whether it is missing
     * its closing braces or simply does not parse, because the two are the same
     * fact to whoever has to fix it.
     *
     * Except the one being written. `{{ s2.` is not a mistake, it is the third
     * keystroke of a path, and marking it while the completion list is open
     * offering the rest of that path is the kind of noise that teaches people
     * to stop looking at marks. Leave the hole and it says so.
     */
    const editing = chip === null && caret >= hole.start && caret <= hole.end
    const broken = !hole.expr && !editing

    pieces.push({ text: value.slice(at, hole.start), start: at })
    pieces.push({
      text: value.slice(hole.start, hole.end),
      start: hole.start,
      className: broken ? styles.broken : styles.hole,
      unclosed: hole === shape.unclosed,
      chip: chipOf(hole, value, scope, chip),
    })
    at = hole.end
  }
  pieces.push({ text: value.slice(at), start: at })

  const drawn = pieces.map((piece) => ({ piece, runs: piece.chip ? [] : runsOf(piece) }))

  /*
   * No marker at rest. It anchors the popups, which cannot be open unless the
   * field has focus — and seating one splits a run's text into two nodes, which
   * is exactly what `offsetAtPoint` must not have to reason about when it
   * translates a click back into an offset in the value.
   */
  const seat = chip
    ? null
    : seatOf(
        drawn.flatMap((entry) => entry.runs),
        caret,
      )

  const draw = (run: Run) => {
    const cut = run === seat ? caret - run.start : -1
    if (cut < 0) {
      return (
        <span key={run.start} className={run.className} data-at={run.start}>
          {run.text}
        </span>
      )
    }
    return (
      <span key={run.start} className={run.className} data-at={run.start}>
        {run.text.slice(0, cut)}
        <span className={styles.caret} ref={mark} />
        {ghost ? <span className={styles.ghost}>{ghost}</span> : null}
        {run.text.slice(cut)}
      </span>
    )
  }

  return drawn
    .filter(
      ({ piece, runs }) => piece.chip || piece.text !== '' || runs.some((run) => run === seat),
    )
    .map(({ piece, runs }) => {
      if (piece.chip) {
        return (
          <span key={piece.start} className={styles.chip} data-at={piece.start} data-hole="">
            {piece.chip.of === 'reference' ? (
              <>
                <KindMark kind={piece.chip.kind} />
                <span className={styles.chipSource}>{piece.chip.source}</span>
                <span className={styles.chipLeaf}>{piece.chip.leaf}</span>
              </>
            ) : (
              piece.chip.parts.map((part) =>
                part.of === 'reference' ? (
                  <span key={part.at} className={styles.chipRef}>
                    <span className={styles.chipSource}>{part.source}</span>
                    <span className={styles.chipLeaf}>{part.leaf}</span>
                  </span>
                ) : (
                  <span key={part.at} className={styles.chipCode}>
                    {part.text}
                  </span>
                ),
              )
            )}
          </span>
        )
      }
      // A plain stretch of text is one run and needs no wrapper; a hole needs
      // one to carry the colour across its three.
      if (!piece.className) return draw(runs[0] as Run)
      return (
        <span key={piece.start} className={piece.className}>
          {runs.map(draw)}
        </span>
      )
    })
}

/**
 * Which offset in the value a click at this point means.
 *
 * At rest the mirror is a different width from the `<input>` behind it — that
 * is the whole point of a chip — so the offset the browser derives from the
 * pointer is measured against text nobody can see. Click the word after a chip
 * and the caret lands several characters earlier, inside the hole.
 *
 * So the engine's own text hit-testing is borrowed and pointed at the mirror
 * instead. Flipping `pointer-events` for the length of one synchronous call is
 * what makes `caretPositionFromPoint` resolve into the visible text: no frame
 * is painted in between, so nothing about the field changes, and the answer
 * comes from the engine rather than from a second implementation of text
 * measurement that would have to know about wrapping, ligatures and bidi.
 *
 * A chip stands for characters it does not show, so no offset inside one means
 * anything: the answer there is the end of its expression, which is where an
 * edit starts.
 *
 * Only ever called at rest, which is also why every run's text node begins
 * exactly where its `data-at` says — the caret marker that would split one is
 * not rendered then.
 *
 * Null when the point is over nothing the mirror rendered, which the caller
 * reads as "leave it to the platform".
 */
function offsetAtPoint(
  mirror: HTMLDivElement | null,
  field: (HTMLInputElement & HTMLTextAreaElement) | null,
  value: string,
  holes: readonly HoleSpan[],
  x: number,
  y: number,
): number | null {
  if (!mirror || !field) return null

  // A chip's whole box, padding included, stands for its hole. Asked of the
  // engine, a point in the padding resolves to whichever text node comes next,
  // so the last few pixels of a chip would put the caret outside the hole the
  // user just clicked on.
  for (const element of mirror.querySelectorAll('[data-hole]')) {
    const box = element.getBoundingClientRect()
    // Half-open, so a point on the edge between two chips belongs to exactly
    // one of them. Closed on both sides, the one earlier in the document won
    // every tie — and on a wrapped Template that is the chip on the line above.
    if (x < box.left || x >= box.right || y < box.top || y >= box.bottom) continue
    const start = Number(element.getAttribute('data-at'))
    const hole = holes.find((candidate) => candidate.start === start)
    return hole ? expressionEnd(value, hole) : start
  }

  mirror.style.pointerEvents = 'auto'
  field.style.pointerEvents = 'none'
  let node: Node | null = null
  let offset = 0
  try {
    // `caretRangeFromPoint` is the same thing under WebKit's older spelling.
    const position = document.caretPositionFromPoint?.(x, y)
    if (position) {
      node = position.offsetNode
      offset = position.offset
    } else {
      const range = document.caretRangeFromPoint?.(x, y)
      node = range?.startContainer ?? null
      offset = range?.startOffset ?? 0
    }
  } finally {
    mirror.style.pointerEvents = ''
    field.style.pointerEvents = ''
  }

  const run = (node instanceof Element ? node : node?.parentElement)?.closest('[data-at]')
  if (!run || !mirror.contains(run)) return null
  return Number(run.getAttribute('data-at')) + offset
}

/**
 * Which run the caret sits in.
 *
 * A caret on the boundary between two belongs to exactly one of them, or two
 * markers are rendered and the ref keeps whichever React wrote last.
 * Strictly-inside wins first, so a caret in the middle of a path seats the
 * ghost beside it; failing that the earliest run that ends there takes it,
 * which is where the caret visually is.
 */
function seatOf(runs: readonly Run[], caret: number): Run | null {
  const inside = runs.find((run) => caret > run.start && caret < run.start + run.text.length)
  if (inside) return inside
  return runs.find((run) => caret >= run.start && caret <= run.start + run.text.length) ?? null
}

/**
 * Which call the caret is inside, and which parameter of it.
 *
 * The active parameter is the comma count at depth zero, which is the same rule
 * the grammar applies and needs no AST: an argument list is being *typed*, so
 * more often than not it does not parse yet. Reading it off the text is not a
 * second definition of the language — it is a count of two characters — and
 * nothing about the answer is used to decide meaning.
 */
function signatureAt(
  value: string,
  caret: number,
  holeStart: number | undefined,
): { spec: FunctionSpec; active: number } | null {
  if (holeStart === undefined) return null

  let depth = 0
  let commas = 0
  let openAt = -1
  const stack: { at: number; commas: number }[] = []
  let quote: string | null = null

  for (let i = holeStart; i < caret; i++) {
    const char = value[i]

    /*
     * Text literals are stepped over whole. Counted as ordinary characters, the
     * `(` in `text.join(items, '(')` opens a call that never closes, and the
     * signature strip goes on naming a parameter of it for the rest of the
     * hole.
     */
    if (quote) {
      if (char === '\\') i++
      else if (char === quote) quote = null
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      continue
    }

    if (char === '(') {
      stack.push({ at: openAt, commas })
      openAt = i
      commas = 0
      depth++
    } else if (char === ')') {
      const previous = stack.pop()
      openAt = previous?.at ?? -1
      commas = previous?.commas ?? 0
      depth--
    } else if (char === ',' && depth > 0) {
      commas++
    }
  }

  if (depth <= 0 || openAt < 0) return null

  const name = /([a-z][a-z0-9_]*\.[a-z][a-z0-9_]*)$/.exec(value.slice(holeStart, openAt))?.[1]
  const spec = CORE_FUNCTIONS.find((candidate) => candidate.qualified === name)
  return spec ? { spec, active: commas } : null
}

/**
 * The mark at a chip's leading edge: which kind of thing this value comes from.
 *
 * Drawn rather than set in type, because the only bin-and-bolt glyphs in a text
 * font are emoji, which render at a size and colour the row does not control.
 * Undescribed on purpose: the mirror is `aria-hidden` in its entirety — it is
 * the same value twice — so a screen reader reads the `<input>`, which holds
 * the path itself and needs no mark to explain it.
 */
function KindMark({ kind }: { kind: ScopeEntry['kind'] }) {
  return (
    <svg
      className={styles.mark}
      viewBox="0 0 12 12"
      width="11"
      height="11"
      focusable="false"
      aria-hidden="true"
    >
      {kind === 'step' ? (
        // A node in the tree.
        <rect x="2.5" y="2.5" width="7" height="7" rx="1.6" />
      ) : kind === 'trigger' ? (
        // What starts a run: a mark pointing forward.
        <path d="M4 2.4 9.2 6 4 9.6z" />
      ) : kind === 'var' ? (
        // A value the workflow keeps, held on a shelf.
        <path d="M2.6 3.6h6.8M2.6 6h6.8M2.6 8.4h4.4" />
      ) : kind === 'param' ? (
        // Handed in from outside: an arrow arriving at the Board's edge. A
        // Block's Board is the only scope that has one, and without a case here
        // every parameter is drawn with the Run Context's mark — which says the
        // opposite, that the value is ambient and around the whole run.
        <path d="M2 6h5.2M5.4 3.9 7.6 6l-2.2 2.1M9.6 2.4v7.2" />
      ) : (
        // Ambient, and around the whole run.
        <>
          <circle cx="6" cy="6" r="3.6" />
          <circle cx="6" cy="6" r="1.1" />
        </>
      )}
    </svg>
  )
}

/** `dt.add(value: datetime, …) → datetime`, with the active parameter emphasised. */
function SignatureHelp({ spec, active }: { spec: FunctionSpec; active: number }) {
  const current = spec.params[Math.min(active, spec.params.length - 1)]

  return (
    <div className={styles.signature} role="status">
      <p className={styles.signatureLine}>
        {spec.qualified}(
        {spec.params.map((param, index) => (
          <span key={param.name}>
            <span className={cx(index === active && styles.activeParam)}>
              {param.name}: {param.type}
            </span>
            {index < spec.params.length - 1 ? ', ' : ''}
          </span>
        ))}
        ) → {spec.returns}
      </p>
      {current?.description ? <p className={styles.signatureDoc}>{current.description}</p> : null}
    </div>
  )
}
