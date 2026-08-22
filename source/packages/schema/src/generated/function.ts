// GENERATED — do not edit.
// Source: schemas/function-manifest.schema.yaml
// Regenerate: pnpm codegen
import { z } from 'zod'

export const functionNamespace = z.strictObject({
  kind: z.enum(['function']),
  /**
   * The part before the dot. Namespaces need no reserved words because the `(` is what distinguishes a call from a path, so a step may still be called `crm`.
   */
  namespace: z.string().regex(/^[a-z][a-z0-9_]*$/),
  /**
   * One sentence, shown beneath the namespace in the function picker.
   * Written for the person building a workflow, who has never seen this file and cannot act on anything expressed in its terms. Say what the functions are for and what a user would be surprised by — that dividing gives a decimal, that changing case ignores their region — and never how any of it is implemented. "In both languages", "no lambdas in v1" and "at the slot boundary" are facts about this repository, not about the workflow someone is writing. See .agents/rules/rendered-copy-is-written-for-the-hosts-users.md.
   */
  summary: z.string().optional(),
  get functions() {
    return z.array(functionSpec).min(1)
  },
})
export type FunctionNamespace = z.infer<typeof functionNamespace>

export const functionSpec = z.strictObject({
  name: z.string().regex(/^[a-z][a-z0-9_]*$/),
  /**
   * One sentence, shown in the function picker and under the focused row of the completion list. Written for the person building a workflow — see the namespace's own `summary`.
   */
  summary: z.string().optional(),
  get params() {
    return z.array(param).optional()
  },
  get returns() {
    return valueType
  },
})
export type FunctionSpec = z.infer<typeof functionSpec>

export const param = z.strictObject({
  name: z.string().regex(/^[a-z][a-z0-9_]*$/),
  get type() {
    return valueType
  },
  /**
   * One sentence saying what this parameter is for, shown beside its input in the function builder and as signature help while the call is being typed. Written for the person building a workflow — see the namespace's own `summary`.
   * Optional here so an existing Host manifest keeps validating; Hatua's own `schemas/functions/*.yaml` are held to a stricter rule by the generator, which refuses to build without one.
   */
  description: z.string().optional(),
  /**
   * Optional parameters must come last.
   */
  optional: z.boolean().optional(),
  /**
   * One or more of this type. Only the last parameter may be variadic.
   */
  variadic: z.boolean().optional(),
})
export type Param = z.infer<typeof param>

/**
 * The Component Manifest's output types, plus the two that exist only in the expression language: `unknown` for a value whose type cannot be known statically — which is accepted with a warning and checked at run time — and `null`, the one absent value, which satisfies any declared type.
 */
export const valueType = z.enum([
  'text',
  'number',
  'boolean',
  'datetime',
  'list',
  'object',
  'item',
  'unknown',
  'null',
])
export type ValueType = z.infer<typeof valueType>

/**
 * The Host-supplied declaration of functions an Expression may call — `crm.owner_of(...)`, `pricing.tier(...)`. Hatua ships its own set under `dt`, `text`, `num`, `list` and `json`; the format is identical and the only difference is who wrote the file.
 * Hatua never implements a Host function. It reads the signature so the builder can offer it, check its arity and argument types, and know what it returns; the Host's runner supplies the code. A declaration with no implementation behind it fails when the registry is built, not at a call site in production.
 * This is a separate file rather than a third `kind:` inside the Component Manifest. A conditional manifest shape — `if kind is function then ...` — would need the JSON-Schema-to-zod generator to grow `if`/`then` support, and ADR-0006 keeps that generator deliberately narrow precisely because a silent mistranslation there is the failure the whole decision prevents.
 * A namespace and name Hatua already declares is a loud error at merge time. Either silent winner — Hatua's or the Host's — is a workflow that behaves differently depending on which registry was built first, and neither is discoverable from the workflow.
 */
export const functionManifest = z.union([
  functionNamespace,
  z.strictObject({
    get namespaces() {
      return z.array(functionNamespace)
    },
  }),
])
export type FunctionManifest = z.infer<typeof functionManifest>
