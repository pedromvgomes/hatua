// GENERATED — do not edit.
// Source: schemas/context-manifest.schema.yaml
// Regenerate: pnpm codegen
import { z } from 'zod'

export const contextKey = z.strictObject({
  /**
   * The name an Expression writes — `run.tenant`. Constrained to the identifier shape the grammar can address without quoting, because a key nothing can name is a key nothing can read.
   */
  k: z.string().regex(/^[a-z][a-z0-9_]*$/),
  /**
   * Friendly name shown in the reference tree, alongside the mono path.
   */
  label: z.string().min(1),
  /**
   * What the value is, checked against the field a Reference to it lands in. There is no `item` here: `item` is the for-each escape hatch, resolved by following a loop's `list` back to its source output, and a Run Context key is not the output of anything.
   */
  t: z.enum(['text', 'number', 'boolean', 'datetime', 'object', 'list']),
  /**
   * One sentence saying what this value is, shown under the focused row in the completion list and beside the row in the picker.
   */
  description: z.string().optional(),
  /**
   * Shape of each list element or object member.
   */
  get of() {
    return z.array(contextKey).optional()
  },
})
export type ContextKey = z.infer<typeof contextKey>

/**
 * The Host-supplied declaration of the ambient values it hands its runner for every execution — the run id, the tenant, the caller's address, when the run started, who triggered it. Addressed as `run.` from any Expression, beside `triggers.` and `var.`.
 * Hatua only ever reads these. It declares no keys of its own and invents none: without a declaration there is no Run Context, the same bargain ADR-0007 strikes for connections and ADR-0010 for functions — a shape Hatua reads so the builder can offer and type-check it, and values the Host's runner supplies.
 * There is exactly one Run Context per execution, so this file declares keys directly rather than naming a type someone instantiates. That is why there is no `use`, no `name`, and no catalogue wrapper: a Host serves one of these, and a second is a mistake rather than a longer list.
 * A key is spelled `{k, label, t}` — the same triple every declared output already uses, with `of` nesting the same way — because the reference tree, the completion list and the type checker read outputs today and a second spelling for the same idea would be a second reader to keep in step. What it adds is `description`, for the sentence the completion list shows under the focused row.
 * This is a separate file rather than a fourth `kind:` inside the Component Manifest, for the reason ADR-0010 gives about functions: a conditional manifest shape would need the JSON-Schema-to-zod generator to grow `if`/`then`, and ADR-0006 keeps that generator deliberately narrow precisely because a silent mistranslation there is the failure the whole decision prevents. A Component Manifest requires `use`, `name`, `fields` and `outputs`, none of which a Run Context has.
 */
export const runContextManifest = z.strictObject({
  /**
   * What this entry is, read by every consumer of the flat array `ManifestSource` returns. It is required rather than defaulted so an entry that carries no kind is a wiring mistake something can name, not a component that silently vanishes.
   */
  kind: z.enum(['context']),
  /**
   * Every value the Host promises to supply, addressed as `run.<k>`. An empty list is a Host that declares no ambient values, which is a legitimate answer and not a failure.
   */
  get keys() {
    return z.array(contextKey)
  },
})
export type RunContextManifest = z.infer<typeof runContextManifest>
