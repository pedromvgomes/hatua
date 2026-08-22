import type { ContextKey, Manifest, RunContextManifest } from './generated'

/**
 * What a mappable field is, and the one built-in name.
 *
 * There is deliberately no `REFERENCE_PATTERN` regex here. A regex would be a
 * second definition of what a Reference is, and two definitions of one thing
 * disagree eventually — a pattern loose enough to match `{{ steps.s2.count }}` also
 * matches `{{ a + b }}` and calls the whole thing a reference path.
 *
 * A Reference is an AST shape — `isReference()` in `@hatua/expressions` —
 * and this file keeps only what the schema layer genuinely owns.
 */

/**
 * The built-in holding the id of whichever Trigger actually fired. Needed
 * because a workflow may declare several triggers with different payloads, so
 * an expression has to be able to branch on which one started this run.
 */
export const TRIGGER_BUILTIN = 'TRIGGER'

/**
 * Field kinds whose value is a Template. The rest hold literal values only.
 *
 * `map` is here because each of its entries holds one, even though the field
 * itself holds a list rather than a string.
 */
export const MAPPABLE_FIELD_KINDS = ['text', 'mono', 'number', 'textarea', 'ref', 'map'] as const

export const isMappable = (kind: string): boolean =>
  (MAPPABLE_FIELD_KINDS as readonly string[]).includes(kind)

/**
 * One entry of the flat array a Host serves.
 *
 * A Component Manifest declares a step type or a trigger type; a Run Context
 * Manifest declares the ambient values the Host supplies to every execution.
 * They travel together because they answer the same question — *what has this
 * Host declared?* — and splitting them would buy a second store, a second
 * loading state and a second failure state for a payload that is a handful of
 * typed keys.
 *
 * **This union is discriminated and the parse-time one is not**, which is the
 * whole difference. `ComponentManifest` is "one manifest OR a `components:`
 * catalogue": its second arm carries no `kind`, so `[{ components: [...] }]`
 * satisfies it, typechecks, and is then dropped by every consumer that reaches
 * for `.kind`. Every arm here is an object with a required literal `kind`, so
 * the catalogue shape satisfies neither arm and a Host serving one is told so
 * by the compiler rather than by an empty screen. `entryKind()` is the runtime
 * half of the same guarantee, for the endpoint that breaks the promise anyway.
 */
export type ManifestEntry = Manifest | RunContextManifest

/**
 * What an entry declares, or null when it declares nothing this build knows.
 *
 * Null is not the same as invalid: a Host serving an entry from a newer
 * contract than the one embedded here should lose that entry, not the whole
 * catalogue. What is *not* null-able is the check itself — an entry with no
 * `kind` at all is the wiring mistake this exists to name.
 */
export function entryKind(entry: unknown): ManifestEntry['kind'] | null {
  if (entry === null || typeof entry !== 'object') return null
  const kind = (entry as { kind?: unknown }).kind
  return kind === 'component' || kind === 'trigger' || kind === 'context' ? kind : null
}

/**
 * The Component Manifests among the entries — step types and trigger types
 * alike.
 *
 * Through `entryKind`, which is the point of it: the store deliberately passes
 * an entry it cannot read straight through, saying so by name — "a `kind` from
 * a newer contract, a name the Host left off, an outright `null`" — because one
 * bad row must not empty a catalogue. Reaching for `.kind` on that row instead
 * throws from render and takes down the Host's tree, which is the outcome the
 * store's `failed` state exists to avoid.
 */
export const manifestsIn = (entries: readonly ManifestEntry[]): Manifest[] =>
  entries.filter((entry): entry is Manifest => {
    const kind = entryKind(entry)
    return kind === 'component' || kind === 'trigger'
  })

/**
 * The Run Context keys among the entries, flattened.
 *
 * Flattened rather than "the first `kind: context` entry" because nothing stops
 * a Host assembling its array from several sources, and one declaration
 * silently winning over another is the failure a `use` collision would be.
 * Keys are addressed as `run.<k>`, so a duplicate `k` is the Host's to resolve;
 * `workflowScope` takes the first, the way every other lookup here does.
 */
export const contextKeysIn = (entries: readonly ManifestEntry[]): ContextKey[] =>
  entries.flatMap((entry) =>
    entryKind(entry) === 'context' ? ((entry as RunContextManifest).keys ?? []) : [],
  )
