import { CORE_FUNCTIONS, type FunctionSpec, type ValueType } from '@hatua/expressions'
import type { ScopeEntry } from '@hatua/model'
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { cx } from '../primitives/classNames'
import { CompletionList, rowId } from './CompletionList'
import { type Candidate, completionsAt, ghostFor } from './candidates'
import { ExpressionPicker } from './ExpressionPicker'
import {
  caretContext,
  droppedPath,
  dropReference,
  expectedAt,
  insertCandidate,
  spliceAt,
} from './insertion'
import styles from './TemplateInput.module.css'
import css from './TemplateInput.module.css?inline'
import { templateShape } from './templateSpans'

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
 * type through. A pill you have to delete and re-add to fix one character makes
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
   * Undefined where nothing declares one — a workflow variable, whose type is
   * read *from* its value — and then no row is ever marked. There is nothing to
   * check against, and a rail that is always neutral is at least honest.
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
  const field = useRef<HTMLInputElement & HTMLTextAreaElement>(null)
  const mirror = useRef<HTMLDivElement>(null)
  const caretMark = useRef<HTMLSpanElement>(null)

  const [draft, setDraft] = useState(value)
  const [committed, setCommitted] = useState(value)
  const [caret, setCaret] = useState(0)
  const [open, setOpen] = useState<OpenSurface>('none')
  const [active, setActive] = useState(0)
  const [at, setAt] = useState({ left: 0, top: 0 })
  const [anchor, setAnchor] = useState({ left: 0, top: 0, bottom: 0 })
  const pending = useRef<number | null>(null)

  // Set during render rather than in an effect: an effect paints the stale
  // value first, so an undo flashes the old text before correcting itself.
  if (value !== committed) {
    setCommitted(value)
    setDraft(value)
  }

  const shape = useMemo(() => templateShape(draft), [draft])
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

  useLayoutEffect(() => {
    if (open === 'none') return
    const rect = caretMark.current?.getBoundingClientRect()
    const box = field.current?.getBoundingClientRect()
    if (!rect || !box) return
    setAt({ left: rect.left, top: rect.bottom + 4 })
    if (open === 'picker') setAnchor({ left: rect.left, top: rect.top, bottom: box.bottom })
  }, [open])

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
      setOpen(inside ? 'completion' : 'picker')
      setActive(0)
      return
    }

    if (open === 'completion' && candidates.length > 0) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        const step = event.key === 'ArrowDown' ? 1 : -1
        setActive((current) => (current + step + candidates.length) % candidates.length)
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

    if (event.key === 'Escape') {
      if (open !== 'none') {
        event.preventDefault()
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
    setDraft(next)
    setCaret(to)

    // Completion follows TYPING. Opening on caret placement instead would bury
    // the field under a popup every time someone clicked into a hole to fix a
    // character.
    if (next.slice(Math.max(0, to - 2), to) === '{{') {
      // Closed on the user's behalf, with the caret left between. A hole is the
      // only thing `{{` can be, and leaving it open means every completion
      // accepted into it lands in text that does not parse — so the highlight
      // stays off and the checker has nothing to say until two more characters
      // are typed by hand.
      write(spliceAt(next, to, to, '  }}', 1))
      setOpen('completion')
      setActive(0)
      return
    }
    if (open === 'completion' && caretContext(next, to).hole === null) setOpen('none')
  }

  const Field = multiline ? 'textarea' : 'input'

  return (
    <>
      <style href="hatua-template-input" precedence="hatua">
        {css}
      </style>
      <div className={styles.wrap}>
        <div className={cx(styles.box, multiline && styles.tall, invalid && styles.invalid)}>
          {/*
            The mirror. `aria-hidden` because it is the same characters twice:
            a screen reader reads the input, and this exists only so the holes
            can be painted where they actually sit.
          */}
          <div className={styles.mirror} ref={mirror} aria-hidden="true">
            {paint(draft, shape, caret, caretMark)}
            {ghost ? <span className={styles.ghost}>{ghost}</span> : null}
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
            onBlur={(event) => commit(event.currentTarget.value)}
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
            onClick={(event) => {
              const box = event.currentTarget.getBoundingClientRect()
              // Right-aligned to the button, which is at the field's trailing
              // edge — so the panel hangs under the field rather than off the
              // side of the 304px column it lives in. `placement` clamps it to
              // the viewport from there.
              setAnchor({ left: box.right - 392, top: box.top, bottom: box.bottom })
              setOpen('picker')
            }}
          >
            <svg viewBox="0 0 16 16" width="14" height="14" focusable="false" aria-hidden="true">
              <path d="M9 1.5 3.5 9h4l-.5 5.5L12.5 7h-4z" />
            </svg>
          </button>
        </div>

        {signature ? <SignatureHelp spec={signature.spec} active={signature.active} /> : null}
      </div>

      {open === 'completion' && candidates.length > 0 ? (
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

      {open === 'picker' ? (
        <ExpressionPicker
          scope={scope}
          expected={expected}
          anchor={anchor}
          onClose={() => setOpen('none')}
          onChoose={(insert) => {
            const edit = insertCandidate(draft, context, caret, insert)
            write(edit)
            commit(edit.value)
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
function paint(
  value: string,
  shape: ReturnType<typeof templateShape>,
  caret: number,
  mark: React.RefObject<HTMLSpanElement | null>,
) {
  const holes = [...shape.holes, ...(shape.unclosed ? [shape.unclosed] : [])]
  const pieces: React.ReactNode[] = []
  let at = 0

  const push = (text: string, from: number, className?: string) => {
    if (text === '') return
    // The caret may fall inside this piece, in which case it is split around
    // the marker rather than approximated to the nearest boundary.
    const cut = caret - from
    if (cut > 0 && cut < text.length) {
      pieces.push(
        <span key={`${from}a`} className={className}>
          {text.slice(0, cut)}
        </span>,
        <span key={`${from}m`} className={styles.caret} ref={mark} />,
        <span key={`${from}b`} className={className}>
          {text.slice(cut)}
        </span>,
      )
      return
    }
    if (cut === 0) pieces.push(<span key={`${from}m`} className={styles.caret} ref={mark} />)
    pieces.push(
      <span key={from} className={className}>
        {text}
      </span>,
    )
    if (cut === text.length)
      pieces.push(<span key={`${from}e`} className={styles.caret} ref={mark} />)
  }

  for (const hole of holes) {
    push(value.slice(at, hole.start), at)
    push(
      value.slice(hole.start, hole.end),
      hole.start,
      hole === shape.unclosed ? styles.broken : styles.hole,
    )
    at = hole.end
  }
  push(value.slice(at), at)

  return pieces
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

  for (let i = holeStart; i < caret; i++) {
    const char = value[i]
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
