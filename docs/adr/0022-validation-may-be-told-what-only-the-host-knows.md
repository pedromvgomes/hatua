# Validation may be told what only the Host knows

Every rule family in `@hatua/model` before the connection rules answers from the **Workflow
Definition** and the manifests, and nothing else. That is what lets `validateDefinition` be a pure
synchronous function, run on every keystroke, in both languages, over the same corpus.

A **Connection**'s type breaks it. ADR-0007 stores nothing in the definition but an opaque `ref`, so
what type that handle is comes from the **Host** — asynchronously, absent when no `ConnectionSource`
is wired, and failable.

> `validateDefinition` takes the connection types as an **input**, in both languages. Their absence
> **narrows** the pass — the two codes that need a type go unreported — and never defers or stops
> it.

## The alternative: builder-only rules

The other reading is that these four codes belong to the builder and the Go SDK does not implement
them. `sdk/go` is a runner: it has no `describe`, no port, and no picker.

That reading costs more than it looks. ADR-0006 makes `schemas/definition-diagnostics.yaml` the
source of truth *for both languages* — a code declared there and implemented in one is the first
exception to that, and an exception nothing enforces is indistinguishable from a missing rule. Making
it enforceable means a new field on every code, a generator that understands it, and a conformance
harness that knows which codes it may not expect. That is a new category, carried by every code
forever, to avoid one parameter.

And the premise is wrong. ADR-0007 says the **Host** resolves a `ref` to credentials **at run time**,
which means the runner is precisely the thing that holds the types. A Go `ValidateDefinition` handed
them is not a fiction about a runner's knowledge; it is the runner checking, before it executes, what
the builder checked before it published. Two of the four codes — `CONNECTION_NOT_ESTABLISHED` and
`CONNECTION_UNKNOWN` — need no types at all and were always answerable in Go.

So the corpus grows a `connections:` scenario input rather than the schema growing an exception.

## Absence is a third answer, and it is silence

`typeOf(ref)` returning nothing means `CONNECTION_UNRESOLVABLE` — "no longer resolves". A checker
handed an empty type source would therefore report that about **every** Connection in the workflow,
on first paint, before the port had answered.

So the input distinguishes *empty* from *absent*, and the two must never collapse:

- **An empty answer is an answer.** A Host that has established no Connections is speaking, and a
  `ref` it does not hold genuinely no longer resolves.
- **No answer is not an empty answer.** No port wired, a port still loading, a port that failed —
  the two type-dependent codes are simply not reported, for as long as that holds.

The distinction is load-bearing rather than tidy: `CONNECTION_TYPE_MISMATCH` `blocks: 'edit'`, so
getting it wrong does not add noise, it locks a document over Connections that are entirely fine.

## And it narrows the pass, never defers it

`createValidationStore` already returns an unready snapshot until the document projects and the
catalogue arrives, on the reasoning that "not checked yet" and "checked and fine" must not look the
same. The Connections are **not** a third such gate.

Those two decide whether *any* rule can run: a document that does not project has no Steps to attach
a diagnostic to, and every Step is an unknown component until the manifests land. The Connections
decide whether *two codes* can run. Folding them into the same flag would leave a Host that wires no
`ConnectionSource` — which is a correct configuration, not a broken one, because
`ConnectionSource` is optional — with **no validation at all**: no required fields, no unknown
components, no expression checking, silently, forever.

That is a worse failure than the one being fixed, and it would pass every test not written for the
unconfigured case.

## Consequences

- **`ConnectionTypes` is a map from `ref` to type, and it is optional.** A function returning
  `undefined` cannot say whether it was asked before the Host answered; a map that is absent can.
- **The Go SDK takes an `Inputs` struct.** The Run Context keys and the connection types are united
  by exactly what makes them awkward — each comes from the caller's environment rather than the
  document, and each may legitimately be absent.
- **A conformance scenario states `connections:`, and its absence is a scenario.** The corpus pins
  the silence as hard as it pins the diagnostics, because silence is the answer that is easy to
  implement by accident and wrong to implement carelessly.
- **The validation store reports `checked`, `pending` or `undescribed`** rather than a boolean. A
  reader waiting for an answer has to know whether one is coming: `pending` resolves itself and
  `undescribed` never will, so a Publish gate that waited on the second would wait forever.
- **`CONNECTION_NOT_ESTABLISHED` files under the Connection.** It names no Step, so `byStep`,
  `byTrigger` and `byBlock` all miss it and a fourth bucket is the only honest place. The `conn`
  field pointing at the Connection draws it, looked up by the id the field holds — filed once and
  drawn where it can be acted on, which is what `troubledBlocks` does for a call through a doorway.
- **This does not weaken ADR-0006.** The schema remains the source of truth for every code, and every
  code remains implemented in both languages. What has changed is that a rule may be handed a fact
  the document does not carry.
