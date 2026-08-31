import {
  CORE_FUNCTIONS,
  CORE_NAMESPACES,
  type Expression,
  elementOf,
  type FunctionSpec,
  referencePath,
  referencesIn,
  type TypeNode,
  type ValueType,
} from '@hatua/expressions'
import type { ScopeEntry } from '@hatua/model'

/**
 * What the completion list and both picker tabs offer, built once from the
 * scope and the declared Functions.
 *
 * Pure, and framework-free: the same rows a caret-anchored list shows are the
 * rows a 392px panel shows, because "two surfaces, one set of candidates" is
 * only true if there is one function producing them.
 *
 * **`CORE_FUNCTIONS`, never `coreFunctions()`.** The latter builds the runtime
 * registry and pulls all thirty-four implementations into a Host's bundle; the
 * declarations carry everything a list and an inserter need, which is what the
 * `summary` and `ParamSpec.description` fields exist for.
 */

export type CandidateSource = 'value' | 'namespace' | 'function'

export interface Candidate {
  /** Stable across rebuilds, so a selected row survives a keystroke. */
  id: string
  /** What the row reads, and what a typed prefix is matched against. */
  label: string
  /** What replaces the typed prefix when the row is accepted. */
  insert: string
  source: CandidateSource
  /**
   * The type the row produces, or undefined for a namespace — which produces
   * nothing, because `dt` is not a value until a `(` follows a name after it.
   */
  type?: ValueType
  /** One sentence, shown in the docstring strip under the list. */
  summary?: string
  /** Present on a function row, for signature help and the inserter. */
  spec?: FunctionSpec
  /** Present on a value row: the whole path, which is what a drag carries. */
  path?: string
  /** Where a value came from, which decides its icon and its picker group. */
  origin?: ScopeEntry['kind']
  /** Whether a dot after this row offers anything. */
  navigable?: boolean
}

/**
 * One addressable value, with whatever can be reached through it.
 *
 * The shape both the completion list and the Reference tab walk. Built from
 * `ScopeEntry.type` by the same rules the checker applies in `validate.ts` — a
 * list has no members, its *elements* do — so a row the picker offers is a row
 * that type-checks.
 */
export interface RefNode {
  path: string
  label: string
  type: ValueType
  /** Kept on every node, so a leaf several dots down still knows where it is from. */
  origin: ScopeEntry['kind']
  description?: string
  /** Null when nothing can be reached through it: a scalar, or an opaque object. */
  children: RefNode[] | null
}

/**
 * The scope as a tree.
 *
 * Dotted paths are one entry and not two — `triggers.nightly` is a single
 * `ScopeEntry` — so the roots have to be recovered: everything before the first
 * dot becomes a grouping node that is itself unaddressable. `{{ triggers }}` is
 * not a value, which is exactly what `walkName` reports as a prefix rather than
 * a reference.
 *
 * Every root is a grouping prefix, because ADR-0014 leaves nothing else at the
 * root: a Step groups under `steps` exactly as a Trigger groups under
 * `triggers`, and the source select offers a handful of sources that do not
 * grow with the workflow rather than one per Step.
 */
export function referenceTree(scope: readonly ScopeEntry[]): RefNode[] {
  const roots: RefNode[] = []
  const prefixes = new Map<string, RefNode>()

  for (const entry of scope) {
    const dot = entry.path.indexOf('.')
    const node = nodeFor(entry.path, entry.type, entry.kind, entry.label, entry.description)

    if (dot === -1) {
      roots.push(node)
      continue
    }

    const head = entry.path.slice(0, dot)
    let group = prefixes.get(head)
    if (!group) {
      group = {
        path: head,
        label: PREFIX_LABELS[head] ?? head,
        // A prefix yields nothing on its own. `unknown` rather than `object`
        // because it is not a value at all, and the type marking must never
        // paint it as one that fits.
        type: 'unknown',
        origin: entry.kind,
        children: [],
      }
      prefixes.set(head, group)
      roots.push(group)
    }
    group.children?.push({ ...node, label: entry.label })
  }

  return roots
}

/**
 * What a grouping prefix is called.
 *
 * The user reads these; `run` and `triggers` are how a Template spells them,
 * which is what the mono path beside the label already says. Runtime copy, so
 * nothing here names a manifest or a port.
 */
const PREFIX_LABELS: Readonly<Record<string, string>> = {
  run: 'Run context',
  triggers: 'Triggers',
  params: 'Parameters',
  steps: 'Steps',
  var: 'Variables',
}

function nodeFor(
  path: string,
  type: TypeNode,
  origin: ScopeEntry['kind'],
  label: string,
  description?: string,
): RefNode {
  return {
    path,
    label,
    type: type.type,
    origin,
    ...(description ? { description } : {}),
    children: childrenOf(path, type, origin, false),
  }
}

/**
 * What a dot after this node offers.
 *
 * The rules are the checker's, restated nowhere: a list has no members, so the
 * only step from one is `[]` — "each element" — and everything reached through
 * that projection is itself a list, which is what `settleType` returns for a
 * projected walk. An object with no declared members is opaque rather than
 * empty, so it offers nothing and is not an error either.
 */
function childrenOf(
  path: string,
  type: TypeNode,
  origin: ScopeEntry['kind'],
  projected: boolean,
): RefNode[] | null {
  if (!projected && type.type === 'list') {
    return [
      {
        path: `${path}[]`,
        label: 'each',
        type: 'list',
        origin,
        children: childrenOf(`${path}[]`, type, origin, true),
      },
    ]
  }

  const shape = projected ? elementOf(type) : type
  if (!shape.members) return null

  return Object.entries(shape.members).map(([name, member]) => ({
    path: `${path}.${name}`,
    label: name,
    // Projected, every field read through `[]` is one value per element.
    type: projected ? ('list' as ValueType) : member.type,
    origin,
    children: childrenOf(`${path}.${name}`, member, origin, projected),
  }))
}

/** Every leaf and branch under a node, flattened — what the picker's row list is. */
export function flatten(nodes: readonly RefNode[]): RefNode[] {
  return nodes.flatMap((node) => [
    ...(node.type === 'unknown' && node.children ? [] : [node]),
    ...flatten(node.children ?? []),
  ])
}

const candidateOf = (node: RefNode): Candidate => ({
  id: `value:${node.path}`,
  label: node.path,
  insert: node.path,
  source: 'value',
  type: node.type,
  path: node.path,
  origin: node.origin,
  navigable: node.children !== null,
  ...(node.description ? { summary: node.description } : {}),
})

const NAMESPACE_CANDIDATES: readonly Candidate[] = CORE_NAMESPACES.map((namespace) => ({
  id: `ns:${namespace.namespace}`,
  label: namespace.namespace,
  insert: namespace.namespace,
  source: 'namespace' as const,
  summary: namespace.summary,
  navigable: true,
}))

const functionCandidate = (spec: FunctionSpec): Candidate => ({
  id: `fn:${spec.qualified}`,
  label: spec.qualified,
  // The caret lands between the parens: a call with no argument is never what
  // was meant, and closing it here saves the one keystroke nobody enjoys.
  insert: `${spec.qualified}(`,
  source: 'function',
  type: spec.returns,
  summary: spec.summary,
  spec,
})

/** Every Function, for the picker's *All namespaces* default. */
export const FUNCTION_CANDIDATES: readonly Candidate[] = CORE_FUNCTIONS.map(functionCandidate)

/**
 * What is on offer for the text typed so far inside a hole.
 *
 * Three cases, and the dot decides which. Before any dot the answer is the
 * scope roots and then the namespaces, as a second block and not interleaved:
 * sorted by label alone, `json`, `list`, `num` and `text` land in among the Step
 * names and the list reads as unrelated rows rather than "what I can read" then
 * "what I can call". After a namespace's dot it is that namespace's Functions;
 * after any other dot it is that node's members and no Functions at all.
 */
export function completionsAt(prefix: string, scope: readonly ScopeEntry[]): Candidate[] {
  const dot = prefix.lastIndexOf('.')
  const base = dot === -1 ? '' : prefix.slice(0, dot)
  const typed = prefix.slice(dot + 1)

  const offered = dot === -1 ? roots(scope) : membersOf(base, scope)
  return offered.filter((candidate) => matches(candidate, base, typed))
}

/** What the typed text is measured against: the last segment, not the whole path. */
const matches = (candidate: Candidate, base: string, typed: string): boolean => {
  const tail = base === '' ? candidate.label : candidate.label.slice(base.length + 1)
  return tail.toLowerCase().startsWith(typed.toLowerCase())
}

function roots(scope: readonly ScopeEntry[]): Candidate[] {
  const tree = referenceTree(scope)
  return [
    ...tree.map((node) => ({
      ...candidateOf(node),
      // A grouping prefix is not a value, so accepting it inserts the prefix
      // and a dot and leaves the list open on its members.
      ...(node.type === 'unknown' && node.children ? { insert: `${node.path}.` } : {}),
    })),
    ...NAMESPACE_CANDIDATES.map((candidate) => ({ ...candidate, insert: `${candidate.label}.` })),
  ]
}

function membersOf(base: string, scope: readonly ScopeEntry[]): Candidate[] {
  const namespace = CORE_NAMESPACES.find((entry) => entry.namespace === base)
  if (namespace) {
    return CORE_FUNCTIONS.filter((spec) => spec.namespace === base).map(functionCandidate)
  }

  const node = find(referenceTree(scope), base)
  return (node?.children ?? []).map(candidateOf)
}

function find(nodes: readonly RefNode[], path: string): RefNode | null {
  for (const node of nodes) {
    if (node.path === path) return node
    if (path.startsWith(`${node.path}.`) || path.startsWith(`${node.path}[`)) {
      const hit = find(node.children ?? [], path)
      if (hit) return hit
    }
  }
  return null
}

/**
 * The ghost text: the part every remaining candidate agrees on.
 *
 * Ghost text *and* the list, not one or the other. The ghost completes the
 * common prefix and gives the fast path; the list is how anyone discovers the
 * members of `s2.messages[]` they do not know. At a dot with no common prefix
 * there is no ghost, and the list alone is the answer.
 */
export function ghostFor(prefix: string, candidates: readonly Candidate[]): string {
  if (candidates.length === 0) return ''

  const dot = prefix.lastIndexOf('.')
  const base = dot === -1 ? '' : prefix.slice(0, dot)
  const typed = prefix.slice(dot + 1)

  const tails = candidates.map((candidate) =>
    base === '' ? candidate.label : candidate.label.slice(base.length + 1),
  )

  let common = tails[0] as string
  for (const tail of tails) {
    while (!tail.toLowerCase().startsWith(common.toLowerCase())) common = common.slice(0, -1)
  }

  return common.slice(typed.length)
}

/**
 * What a Reference is called, in the words the person reading it would use, and
 * where its value comes from.
 *
 * Two parts, because a label alone answers the wrong half. "Fetch emails count"
 * carries its source only because a Step happens to have a name — `var.digest_to`
 * reduced to "digest_to", and two chips reading "digest_to" and "count" say
 * nothing at all about where either value is from.
 *
 * So the source is always present: the Step's or Trigger's own name where the
 * path passes through one, and the kind's own word where it does not. `run.id`
 * is "Run context", never "run", because `run` is how a Template spells a root
 * and not what anybody calls it.
 */
export type ChipParts =
  | {
      of: 'reference'
      /** Which of the four kinds, for the mark at the chip's leading edge. */
      kind: ScopeEntry['kind']
      /** Dimmed, and the answer to "where is this from". */
      source: string
      /** Accented, and the answer to "which value". */
      leaf: string
    }
  /**
   * Everything else a hole can hold.
   *
   * `{{ steps.s2.count + 1 }}` is every bit as much a hole as `{{ steps.s2.count }}` and has
   * to look like one, but there is no single value behind it to name — which is
   * exactly what makes it not a Reference. So it shows its own text, with no
   * mark, and the absence of one is what tells the two apart without inventing
   * a symbol for "computed".
   *
   * The References *inside* it are still named, though. `s2` is a Step's id and
   * putting it on a chip is the thing a chip exists to stop — one field showing
   * "Fetch emails › count" beside a raw `s2.count` is two vocabularies at once,
   * and the raw one is the half nobody chose.
   *
   * A Reference whose path has gone stale lands here too, and that is the
   * point: it keeps showing the path, and the missing source is the signal that
   * nothing answers to it any more.
   */
  | { of: 'expression'; parts: readonly ChipPart[] }

/**
 * A stretch of an expression: either its own characters, or a Reference named.
 *
 * `at` is the offset it starts at, which is its identity — the parts are
 * positional slices of one string, and the string is what changes them.
 */
export type ChipPart =
  | { of: 'text'; at: number; text: string }
  | { of: 'reference'; at: number; kind: ScopeEntry['kind']; source: string; leaf: string }

/**
 * Null when the path names nothing in scope. A Reference that has gone stale —
 * a renamed variable, a removed Step — must keep showing the path it actually
 * holds, because the path is what the checker will name and what has to be
 * edited; a chip reading "Fetch emails count" over a Step that no longer exists
 * would hide the one fact worth seeing.
 */
export function chipFor(path: string, scope: readonly ScopeEntry[]): ChipParts | null {
  const chain = chainTo(referenceTree(scope), path)
  if (!chain) return null

  const kind = chain[0]?.origin ?? 'step'
  // A grouping prefix yields nothing on its own, so it names nothing either.
  const named = chain.filter((node) => !isGroup(node))
  const [first, ...rest] = named
  if (!first) return null

  // One named thing means the path stops at the entity itself and the entity's
  // own label IS the value, so the kind supplies the source instead.
  if (rest.length === 0) {
    return { of: 'reference', kind, source: KIND_WORDS[kind], leaf: first.label }
  }

  return {
    of: 'reference',
    kind,
    source: first.label,
    leaf: rest.map((node) => node.label).join(' '),
  }
}

/**
 * What each kind is called when nothing else names it.
 *
 * Singular, and in the reader's words rather than the document's: a chip says
 * "Variable", not `var` and not "Workflow variables".
 */
const KIND_WORDS: Readonly<Record<ScopeEntry['kind'], string>> = {
  step: 'Step',
  trigger: 'Trigger',
  param: 'Parameter',
  var: 'Variable',
  context: 'Run context',
  builtin: 'Built-in',
}

/** A grouping prefix yields nothing on its own, which is what `unknown` marks it as. */
const isGroup = (node: RefNode) => node.type === 'unknown' && node.children !== null

function chainTo(nodes: readonly RefNode[], path: string): RefNode[] | null {
  for (const node of nodes) {
    if (node.path === path) return [node]
    if (path.startsWith(`${node.path}.`) || path.startsWith(`${node.path}[`)) {
      const rest = chainTo(node.children ?? [], path)
      if (rest) return [node, ...rest]
    }
  }
  return null
}

/**
 * A computed hole, with every Reference inside it named.
 *
 * Substituted **by span, and only where the source agrees**: a Reference node
 * carries the offset it starts at, and its path is compared against the
 * characters actually there before anything is replaced. Where they differ —
 * whitespace written inside a path, anything unexpected — that occurrence is
 * left exactly as it is.
 *
 * That conservatism is the whole design. Rebuilding the expression from its
 * tree would be AST→text, which the grammar does not provide and which
 * hand-writing makes a second implementation of the language (ADR-0008). This
 * never reconstructs anything: it copies the source through and swaps out
 * stretches it has checked character for character.
 */
export function expressionChip(
  value: string,
  expr: Expression,
  from: number,
  to: number,
  scope: readonly ScopeEntry[],
): ChipPart[] {
  const parts: ChipPart[] = []
  let at = from

  for (const node of referencesIn(expr)) {
    const path = referencePath(node)
    if (!path || node.at < at) continue
    // The source has to say what the tree says before a single character moves.
    if (value.slice(node.at, node.at + path.length) !== path) continue

    const named = chipFor(path, scope)
    if (named?.of !== 'reference') continue

    if (node.at > at) parts.push({ of: 'text', at, text: value.slice(at, node.at) })
    parts.push({ ...named, at: node.at })
    at = node.at + path.length
  }

  if (at < to) parts.push({ of: 'text', at, text: value.slice(at, to) })
  return parts
}
