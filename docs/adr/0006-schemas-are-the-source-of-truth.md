# The YAML schemas are the source of truth, not the zod

`packages/schema` used to be hand-written zod. It is now generated from
`source/schemas/*.schema.yaml` — JSON Schema, hand-authored in YAML. Zod is far pleasanter to write,
so this needs justifying.

Once a Go SDK entered scope, the contract had to serve two languages. The obvious route was to keep
zod authoritative and emit JSON Schema from it with `z.toJSONSchema()`. Measured, that loses exactly
the parts that matter:

| Rule | Survives `z.toJSONSchema()` |
| --- | --- |
| `minLength`, `enum`, `required`, min/max | yes |
| Custom error messages | **dropped silently** |
| `.refine()` cross-field rules | **dropped silently — no error, even with `unrepresentable: "any"`** |

A dropped refinement is not cosmetic. It means the Go SDK *accepts* input the TypeScript builder
rejects: a workflow that fails validation in the editor and passes in the runner. Authoring once, in
a neutral format, removes that whole class of divergence — and puts every error message in one place
both generators read.

## What generation does not solve

Shape only. The rules that decide whether a workflow is actually valid are cross-field and
manifest-dependent — a required field left empty, a `ref` field with no reference, a non-final
condition branch with no `when`, an empty loop, a connection whose type does not match its field.
None is expressible in JSON Schema, and none belongs in zod either. They live in `@hatua/model` and
are implemented once per language.

`source/conformance/` is what keeps those implementations honest, and it matters more than the
codegen does. Both suites run the same fixtures; a file that passes in one language and fails in the
other is precisely the divergence the corpus exists to catch. When the expression language lands its
semantics get pinned there too — an evaluator agreeing on syntax but disagreeing on, say, null
coercion produces a workflow that looks right in the builder and misbehaves in production.

## Consequences

- **`packages/schema/src/generated/` must never be hand-edited.** CI regenerates and fails on any
  diff, so a stale artefact cannot merge.
- **The generator is deliberately narrow.** It covers the subset `schemas/` uses and throws on
  anything else, because a silent mistranslation here is the exact failure this decision prevents.
- **Recursive shapes use zod 4 getters, not `z.lazy`.** `z.lazy` forces `ZodType<any>` and discards
  the types the pipeline exists to produce; getters defer evaluation while keeping inference. This
  also means `z.strictObject` rather than `z.object().strict()` — `.strict()` reads `.shape`
  eagerly, firing the getters and blowing up on any self-reference.
- **Prose explaining the domain lives in the schema's `description` fields**, since that is what
  survives regeneration and reaches both languages.
