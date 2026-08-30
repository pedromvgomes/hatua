/**
 * A Reference is an AST shape, not a syntax.
 *
 * There is no `expr:` sigil and no marker of any kind: what makes a Reference
 * special is that it names a value and nothing more, which is exactly what lets
 * the builder draw it as a pill the user can retarget. `{{ steps.s2.count }}` is a
 * Reference; `{{ steps.s2.count + 1 }}` is the same language and is not.
 *
 * Answered from the parsed shape rather than by a regex. A pattern would be a
 * second definition of what a Reference is, and two definitions of one thing
 * disagree eventually — one loose enough to match `{{ steps.s2.count }}` also matches
 * `{{ a + b }}` and calls it a reference.
 */
import type { Expression, TemplateNode } from './ast.js'
import { tryParseTemplate } from './parse.js'
import { pathText } from './resolve.js'

/**
 * Whether an expression is exactly a path.
 *
 * Indexing with a literal counts: `s2.messages[0].subject` still names one
 * value and nothing more. A call does not — the moment something is computed,
 * there is no target to retarget.
 */
export function isReference(node: Expression): boolean {
  switch (node.kind) {
    case 'Name':
      return true
    case 'Member':
    case 'Project':
      return isReference(node.object)
    case 'Index':
      return node.index.kind === 'Literal' && isReference(node.object)
    default:
      return false
  }
}

/** The path a Reference names, or null when the expression is not one. */
export function referencePath(node: Expression): string | null {
  return isReference(node) ? pathText(node) : null
}

/**
 * The Reference a whole Template holds, when it holds exactly one and nothing
 * else — which is the case the builder renders as a pill.
 *
 * `Hi {{ steps.s2.name }}` is not one: it is text with a hole in it, and the pill
 * belongs inside the field rather than instead of it.
 */
export function templateReference(template: TemplateNode): string | null {
  const [only] = template.segments
  if (template.segments.length !== 1 || only?.kind !== 'Hole') return null
  return referencePath(only.expr)
}

/** The same, from source, for callers that have not parsed anything yet. */
export function sourceReference(template: string): string | null {
  const parsed = tryParseTemplate(template)
  return parsed.ok ? templateReference(parsed.template) : null
}

/**
 * Every Reference inside an expression, outermost first.
 *
 * Outermost, because `s2.messages[].subject` is one Reference and not four:
 * descending into a node that is already one would name its own prefix a second
 * time.
 *
 * Here rather than beside either caller, because both of them ask the same
 * question of the same grammar — the builder to draw each Reference as a pill,
 * a rename to find the ones it invalidates — and two walks of an expression
 * tree are two chances to forget a node kind. A node kind nobody descends into
 * is a Reference nothing draws and a rename silently skips.
 */
export function referencesIn(node: Expression): Expression[] {
  if (isReference(node)) return [node]

  switch (node.kind) {
    case 'Member':
    case 'Project':
      return referencesIn(node.object)
    case 'Index':
      return [...referencesIn(node.object), ...referencesIn(node.index)]
    case 'Call':
      return [...referencesIn(node.object), ...node.args.flatMap(referencesIn)]
    case 'Unary':
      return referencesIn(node.operand)
    case 'Binary':
      return [...referencesIn(node.left), ...referencesIn(node.right)]
    case 'Ternary':
      return [
        ...referencesIn(node.cond),
        ...referencesIn(node.whenTrue),
        ...referencesIn(node.whenFalse),
      ]
    default:
      return []
  }
}

/**
 * Rewrite every Reference under one rooted path, and return the Template.
 *
 * `renamePath(t, 'var.old', 'var.new')` repairs `{{ var.old }}` and
 * `{{ text.upper(var.old) + 1 }}` alike: the walk is over Reference nodes, not
 * over whether the Template *is* one, so a computed hole is rewritten exactly as
 * a bare path is. A rewrite keyed on `templateReference` would repair only the
 * simplest holes and silently skip every interesting one.
 *
 * **Prefixes end at a segment boundary.** Renaming `var.to` leaves `var.total`
 * alone: a path matches when it is `from`, or continues with `.` or `[`.
 *
 * ## It declines rather than guesses
 *
 * ADR-0008 gives this grammar two generators and no AST→text, so nothing here
 * reconstructs an expression from its tree. The source is copied through and
 * only stretches checked character for character against the path the tree
 * reports are swapped — the discipline `expressionChip` follows to draw a pill.
 *
 * Where the two disagree — `{{ var . old }}`, which parses and whose node offset
 * holds something other than `var.old` — that occurrence is returned untouched.
 * There is no way to know which stretch to replace without writing text the
 * grammar cannot produce, and a rename that guessed would corrupt a file Hatua
 * does not own (ADR-0001). A missed occurrence goes stale and is reported, which
 * is the state every consumer already handles (ADR-0021).
 *
 * A Template that does not parse is returned unchanged: a command runs against
 * documents that do not project, and half-written text is one of them.
 */
export function renamePath(source: string, from: string, to: string): string {
  if (from === to) return source
  const parsed = tryParseTemplate(source)
  if (!parsed.ok) return source

  const swaps: { at: number; length: number; text: string }[] = []
  for (const segment of parsed.template.segments) {
    if (segment.kind !== 'Hole') continue
    for (const node of referencesIn(segment.expr)) {
      const path = referencePath(node)
      if (path === null || !under(path, from)) continue
      /*
       * Only the prefix is verified, because only the prefix is replaced.
       *
       * `pathText` renders a literal index as `[…]` rather than the characters
       * that produced it, so `{{ s2.rows[0].k }}` reports `s2.rows[…].k` and no
       * whole-path comparison can ever match. Checking the whole path would
       * therefore decline on every indexed Reference — which is the shape
       * CONTEXT.md leads with — while checking the prefix leaves whatever
       * follows it untouched in the source, indexes and all.
       */
      if (source.slice(node.at, node.at + from.length) !== from) continue
      swaps.push({ at: node.at, length: from.length, text: to })
    }
  }

  // Applied last-first, so an earlier swap cannot move a later one's offset.
  let out = source
  for (const swap of swaps.sort((a, b) => b.at - a.at)) {
    out = out.slice(0, swap.at) + swap.text + out.slice(swap.at + swap.length)
  }
  return out
}

/**
 * Whether `path` is `prefix` or something below it.
 *
 * The boundary check is the whole of it: `startsWith` alone makes renaming
 * `var.to` rewrite `var.total`, which is a different variable and a silent
 * corruption rather than a stale Reference. `[` counts as a boundary because a
 * rooted name may be indexed directly — `var.rows[0]`.
 */
const under = (path: string, prefix: string): boolean =>
  path === prefix || path.startsWith(`${prefix}.`) || path.startsWith(`${prefix}[`)
