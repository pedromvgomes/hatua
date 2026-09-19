---
name: resolve-and-validate-agree-only-by-convention
kind: gotcha
description: resolve.ts and validate.ts re-derive the same operator/function rules independently; only hand-written conformance scenarios in two directories catch drift.
anchors:
  - path: source/packages/expressions/src/resolve.ts
    blob: 777979b3a277
  - path: source/packages/expressions/src/validate.ts
    blob: d8daae8c5a3e
  - path: source/packages/expressions/src/conformance.test.ts
    blob: 838b775b6de4
confidence: verified
---

Runtime evaluation and design-time checking are two hand-written implementations of one rule
set, with no shared table and no type-level link:

- `resolve.ts` — `binary()` (`:379`), `compare()` (`:457`), `arithmetic()` (`:497`),
  `checkArguments()` (`:565`).
- `validate.ts` — `walkCall()` (`:289`), `walkBinary()` (`:352`), `requireType()` (`:433`).
  Arithmetic requiring `number` operands is `validate.ts:399-400`; the runtime's version of
  the same rule is inside `arithmetic()` at `resolve.ts:497`.

`conformance.test.ts` runs them as two independent suites: the `eval` describe block calls
`resolve()` (`conformance.test.ts:123`) and the `diagnostics` block calls `validate()`
(`:162`), each over its own scenario directory — `source/conformance/expression/eval/*.yaml`
and `source/conformance/expression/diagnostics/*.yaml`. Neither suite compares the two.

So a new operator, a new coercion, or a changed one needs **four** edits — `resolve.ts`,
`validate.ts`, a scenario under `eval/`, and a scenario under `diagnostics/`. Missing any one
fails no TypeScript build, no biome run and no `vitest run`, unless a scenario for exactly
that case already exists.

This is a second axis of duplication beyond the TypeScript-vs-Go one that ADR-0008/ADR-0009
solve with the shared PEG grammar and the conformance corpus — and this axis has no single
source of truth at all. The same shape recurs in `nodes.ts`, whose header
(`source/packages/expressions/src/nodes.ts:11-12`) says to keep it in step with
`sdk/go/expressions/nodes.go` "but only if it is caught".
