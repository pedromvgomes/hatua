/**
 * A Reference is an AST shape, not a syntax.
 *
 * There is no `expr:` sigil and no marker of any kind: what makes a Reference
 * special is that it names a value and nothing more, which is exactly what lets
 * the builder draw it as a pill the user can retarget. `{{ s2.count }}` is a
 * Reference; `{{ s2.count + 1 }}` is the same language and is not.
 *
 * This replaces the regex `@hatua/schema` used to carry. A regex is a *second*
 * definition of what a Reference is, and two definitions of one thing disagree
 * eventually — that one matched `{{ a + b }}` and called it a reference.
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
 * `Hi {{ s2.name }}` is not one: it is text with a hole in it, and the pill
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
