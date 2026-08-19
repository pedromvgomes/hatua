# schemas

Hand-authored JSON Schema, in YAML. **This is the source of truth for the contract** — the zod in
`packages/schema/src/generated/` and the Go structs in `sdk/go/` are both generated from here and
must never be edited directly.

## Why not author in zod

Zod is far pleasanter to write, and it was the original plan. It does not survive the round trip:

| Rule | Survives `z.toJSONSchema()` |
| --- | --- |
| `minLength`, `enum`, `required`, min/max | yes |
| Custom error messages | **dropped silently** |
| `.refine()` cross-field rules | **dropped silently — no error, even with `unrepresentable: "any"`** |

A dropped refinement is not a cosmetic loss. It means the Go SDK *accepts* input the TypeScript
builder rejects: a workflow that fails validation in the editor and passes in the runner. Authoring
once, here, removes that whole class of divergence.

## What this cannot express

Shape only. The validation rules that matter most are cross-field and manifest-dependent, and none
of them belongs in a schema:

- a required field left empty
- a `ref` field with no reference
- a non-final condition branch with no `when`
- an empty loop
- a `conn` field pointing at a connection whose type does not match its `conn_type`
- a connection with a null `ref` (blocks publish, not editing)

Those live in `@hatua/model`, are implemented once per language, and are kept honest by
`../conformance/` — which matters more than the codegen does.

## Regenerating

```sh
pnpm --filter @hatua/codegen build     # schemas -> packages/schema/src/generated
```

CI regenerates and fails on any diff, so a stale committed artefact cannot merge.
