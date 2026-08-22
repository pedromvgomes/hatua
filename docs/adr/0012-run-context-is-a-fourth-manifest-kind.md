# Run Context is a fourth manifest kind, served through the manifest port

A **Host** knows things about an execution that no **Trigger** payload carries: which run this is,
which tenant it belongs to, where the request came from, when it started, who started it. Without
somewhere to put them, every Host stuffs the same five fields into every Trigger it declares.

**Run Context** is that somewhere. The Host declares a flat list of typed keys; an **Expression**
reads them as `run.id`, `run.tenant`; Hatua offers them, type-checks against them, and never invents
one. Same bargain as ADR-0007 for connections and ADR-0010 for functions: a declared shape Hatua
reads so the builder can offer and check it, and values the Host's runner supplies. Hatua still never
executes.

## A fourth kind, and ADR-0010's argument applied again

ADR-0010 introduced the third — `function` — and recorded, in doing so, that ADR-0007's "there are
only two manifest kinds" was superseded and *why* the exception was principled: functions are not
connections and raise none of the same questions. The same test applies here and it passes for the
same reason. A Run Context holds no credentials, describes no flow Hatua cannot run, and needs no
server. It is a declaration, and declarations are what manifests are.

**Its own file, not a fourth `kind:` inside the Component Manifest.** A Component Manifest requires
`use`, `name`, `fields` and `outputs`; a Run Context has none of them. Expressing "these keys are
required when `kind` is `context` and forbidden otherwise" needs `if`/`then` in the
JSON-Schema-to-zod generator, and ADR-0006 keeps that generator deliberately narrow precisely because
a silent mistranslation there is the failure the whole decision prevents. That is ADR-0010's own
sentence about `function-manifest.schema.yaml`, and nothing about this kind weakens it.

## The shape

Settled here rather than left open, because this is the PR that gives it a reader.

```yaml
kind: context
keys:
  - { k: id,     label: Run id, t: text,   description: Identifies this execution. }
  - { k: tenant, label: Tenant, t: object, of: [{ k: name, label: Tenant name, t: text }] }
```

**A key is `{k, label, t}`, with `of` nesting the same way an output's does.** The obvious first
draft was `{key, type, description}`, and it would have been a second spelling for an idea the
contract already has one of: the reference tree, the completion list and `outputsToType` all read
`{k, label, t, of}` today, and two spellings mean two readers to keep in step. Reusing it is what
makes `run.tenant.name` type-check with no new code at all. `description` is the one genuine
addition — the sentence the completion list shows under the focused row, which a manifest output has
nowhere to put.

**No `use`, no `name`, no catalogue wrapper.** There is exactly one Run Context per execution, so the
file declares keys directly rather than naming a type someone instantiates, and a second declaration
is a mistake rather than a longer list.

**`t` excludes `item`.** `item` is the for-each escape hatch, resolved by following a loop's `list`
back to its source output. A Run Context key is not the output of anything, so `item` could never
resolve — better refused by the schema than warned about at run time.

**An empty `keys:` is valid.** A Host that wires the port and declares no ambient values is `ready`
with nothing in it, for the same reason an empty catalogue is: "loaded and holds nothing" is a fact
about the data, not a phase of the load.

## Served through `ManifestSource`, and why that is not the hazard ports.ts names

`ManifestSource.loadManifests()` now returns `ManifestEntry[]` — `Manifest | RunContextManifest` —
rather than `Manifest[]`.

A port of its own was the alternative and buys nothing: a second store, second loading and failure
states, second wiring, for a payload that is a handful of typed keys, when the existing port already
returns a flat array whose entries carry `kind`.

`ports.ts` warns by name against a union here, and the warning stands — **for the union it was
about**. `ComponentManifest` is "one manifest OR a `components:` catalogue", and its second arm is a
*container*: an object with no `kind` at all. That is what makes `[{ components: [...] }]` typecheck
and then vanish, because every consumer reaches for `.kind` and finds nothing.

`ManifestEntry` is a different construction. Every arm is an entry, every arm carries a required
literal `kind`, and the catalogue shape satisfies none of them — so the compiler refuses it at the
seam. **The rule the hazard actually names is *no undiscriminated container arm*, not *no union*.**

The runtime half is kept too, because a type is a promise the Host makes and an endpoint can break
it. `createManifestStore` already refused a non-array; it now also refuses an array whose entries
carry a `components` key — one array level off, which is the same mistake as the bare catalogue and
was previously a load that succeeded and rendered nothing. It deliberately refuses *nothing else*: an
entry this build cannot read is the reader's problem, because rejecting a payload over one bad row is
the "one malformed entry empties the catalogue" trade that `manifests.ts` argues against.

## Consequences

- **A fourth `ScopeEntry.kind`, `'context'`.** It sits beside `step`, `trigger`, `var` and `builtin`
  rather than under any of them: nothing in the document declares it, and unlike a variable it cannot
  be edited from the builder at all. Everything switching on that union — the reference tree's
  grouping, the picker's sources — gains a case.
- **`run` is a root of its own in the evaluator**, in both languages, checked by
  `conformance/expression/`. Not a reserved step id: a step may legitimately be called `run`, and
  resolving one root by looking in two places is how a workflow starts depending on which of them the
  runner checked first.
- **`workflowScope(doc, manifests, context)` exists beside `scopeFor`**, because a variable's own
  value has no position in the tree to ask about. `scopeFor` is that plus the upstream Steps, so the
  unpositioned half has one definition and two readers — in both languages.
- **Run Context is readable directly by any Step.** Mapping it into a variable first is optional
  normalisation, not a required gateway: one rule for every unpositioned source, rather than a
  special case only this one has.
- **A Host that declares nothing gets nothing**, and that is a legitimate state rather than a
  failure. Hatua declares no keys of its own, so a workflow written against a Host that has none
  simply has no `run.` to read.
