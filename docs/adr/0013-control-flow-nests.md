# Control flow nests, and jumps are deferred

A **Step** may be reached from more than one place — three branches of a **Fork** that all end by
notifying the same person, a review that repeats until a human approves it. Every graphical workflow
builder answers this with edges: a user drags from one node's exit to another's entry, and
reachability becomes an arbitrary graph.

Hatua does not. **Reachability is nesting**: a Step runs because of where it sits in the tree, and the
only things that change control flow are *containers* — `core.fork`, `core.for_each`, `core.repeat`
and `core.try` — together with a **Block** call, which is a verb in its own namespace rather than a
container. There is no edge to draw, so the canvas offers no connect affordance, no exit handles and
no drawn connectors the user can attach anything to.

## Why, and why not the reason ADR-0001 originally gave

ADR-0001 said arbitrary cross-links "would break this property", meaning derived layout. **That
reasoning is wrong and is corrected there.** AWS Step Functions is a hand-editable file with `Next:`
transitions, no stored positions, and a console that derives the picture; GitHub Actions does the
same with `needs:`. A graph does not force a file to carry coordinates.

The real cost is **exact static scope**, which is Hatua's and not those tools'.

`scopeFor` answers "what can this Step read?" by walking its ancestors. In a tree, in-scope *is* the
path from the root, and the answer is exact — which is what lets the picker offer a list that is
complete, the completion list rank against it, the reference tree group by it, and the type marking
say *this fits* before anything runs. Converge two branches on one Step and the question stops having
a static answer: that Step can safely read only what **every** inbound path produces, so scope becomes
an intersection over paths — a dataflow analysis rather than a walk, and one that degrades from
*exact* to *conservative*. n8n can allow edges because it never promised to tell you, before you run
it, that `{{s3.subject}}` exists.

The second cost is that **Hatua does not execute**. Structured containers are a contract any Host
runner and the Go SDK implement locally. Arbitrary transfer *into* a branch or *out of* a loop is a
control-flow semantics we would be imposing on every Host, in exchange for a shape the tree can
already express.

Because a tree with duplication expresses every reachability shape a DAG can — inline the shared tail
into each path — what edges actually buy is **deduplication, not expressiveness**. That is a real cost
and it is paid deliberately, and a **Block** call pays most of it back.

## A call is a cross-link with a contract; a jump is one without

This is the whole distinction, and it is why `blocks:` is not a back door to the thing this ADR
refuses.

A **Block** is a named, reusable sequence declared once in the document and invoked as
`use: block.<slug>`. It is reachable from three call sites and scope stays an exact walk, **because a
Block reads only its declared parameters and publishes only its declared outputs**. The contract is
what replaces the analysis. A jump target is reachable from three places with no contract at all, so
there is nothing to compute scope from except the intersection.

That sentence is literally true rather than approximately: a Block sees its own **Board** and the
Host's **Run Context**, and nothing else. Not the workflow's variables, not the **Triggers**, not
`TRIGGER`. Run Context is the single exception and earns it — nothing in the document declares it,
the Host supplies it to every execution, so it is available on every path of every Board with no
intersection to compute. Anything else a Block needs, it takes as a parameter.

The same reasoning admits a further consequence: **early exit is safe.** A jump that only ever goes to
the *end* — a future `core.stop` or `core.fail` — adds no inbound path to any Step, so scope is
untouched. It is **joins** that break static scope, not jumps.

## Blocks are also the flattening tool

Deduplication is the obvious use and the smaller one. A workflow with a session loop around a
per-entry loop around a revision loop around a decision is four levels deep and hard to read on a
canvas; extracting the middle into a Block leaves a root of three lines, exactly as extracting a
function does. A jump would not flatten it — it would make a loop *look* flat while remaining as
cyclic, so a reader has to simulate execution to find what repeats and where it stops. Nesting is what
makes the boundary visible without running anything, and collapse already handles depth as chrome.

This is what decides how the canvas draws a Block: **one Board at a time, with a call as a doorway
into another.** Drawing a Block's body inline at its call site was the alternative, and it hands back
everything the extraction bought — the root is as deep as it ever was, and a Block called from three
places is drawn three times, which is the duplication `block.*` exists to remove.

## The verbs

`core.fork`, `core.for_each` and `core.map` already exist. This decision adds three, keeping the set
small enough for a Host runner to implement. Named and given a role here because the refusal above is
meaningless without saying what carries the weight instead; each one's **shape is settled by the PR
that gives it a reader**, and amends this ADR when it does.

- **`core.repeat`** — repeats its children until a condition holds. The gap `core.for_each` leaves:
  it iterates a collection, and nothing repeated on a condition. This is what "send it back for
  another revision" is, and what "ask whether to process another batch" is — the target of both is
  the head of an enclosing container, which is why neither needs a jump.
- **`core.return`** — publishes a **Block**'s declared outputs and ends that Block. It is the mirror
  of `core.map`: the one component whose *inputs* no manifest can declare, because they are the
  enclosing Block's `outputs:`.
- **`core.try`** — a region with a retry policy and a fallback handler. **Wrapping one Step is retry;
  wrapping a region is fallback**, so one verb serves both. Error-type matching needs no matcher of
  its own: a `core.fork` inside the handler branches on the failure.

**Invoking a Block is not a verb.** `core.call` was the first draft and it was refused once the verb
namespace closed (ADR-0014): a call is `use: block.<slug>`, resolved against `blocks:` instead of
against the manifest set, so calling costs a namespace rather than a fourth addition here. It also
removes a reserved field name — under `core.call` the Block's slug had to live in `with:` beside the
parameters, so no Block could declare a parameter called `block`.

Blocks may call blocks; **recursion is refused**, because unbounded recursion is the jump problem
wearing a contract's clothes. Both a direct cycle and an indirect one are design-time diagnostics,
not a run-time depth limit.

`core.try` exposes the failure to its **handler** children and not to its body, the way
`core.for_each` exposes `item` — a container putting a binding into the scope of children it owns,
which the Fork's per-branch scoping already establishes.

The names are `core.*` because **Hatua ships them**, which is what that root means (ADR-0014) —
`core.schedule`, `core.manual` and `core.end` are `core.*` too and none of them is control flow.
`error.handler` was the first draft and reads like a Host namespace, which is the confusion a closed
root exists to prevent.

## The Block's shape, and the Board

```yaml
blocks:
  - id: archive_entry
    name: Archive an entry
    params:
      - k: entry
        label: Entry
        t: object
        of: [{ k: headline, label: Headline, t: text }]
      - { k: at, label: Archived at, t: datetime }
    outputs:
      - { k: url, label: Archive URL, t: text }
    vars:
      - { key: attempt_note, value: "" }
    steps:
      - id: put
        use: component.s3.upload
        with: { key: "{{ params.at }}", body: "{{ params.entry }}" }
      - id: ret
        use: core.return
        with: { url: "{{ steps.put.location }}" }
```

**`blocks:` is a top-level section beside `steps:` and `vars:`, and a list rather than a map.** The
schema already argues this on `vars` — "a list of key/value objects rather than a map, so a `type` or
`label` can be added later without a breaking change to every existing file" — and a larger payload
does not weaken an argument about extensibility.

**Parameters and outputs are `{k, label, t, of}`.** ADR-0012 faced this same fork for Run Context
keys, rejected `{key, type, description}` as "a second spelling for an idea the contract already has
one of", and that reasoning holds here unchanged: `outputsToType` turns exactly this shape into a
`TypeNode`, so `{{ params.entry.headline }}` type-checks and `{{ steps.archive_1.url }}` type-checks
with no new code in either language. It also makes `params.` an exact mirror of `triggers.` — both
are a **Board**'s parameter contract, both read by one function.

**A Board is one drawable Step tree and its root**: the root Board, whose root is the Triggers, and
one per Block, whose root is its contract. `scopeFor` therefore roots its walk at the Board an id
sits on, and what each Board sees is exact with no intersection to compute:

| | root Board | Block Board |
| --- | --- | --- |
| `run.*` | the Host's Run Context | the same — the one thing that crosses |
| `triggers.*`, `TRIGGER` | the parameter contract | *absent* |
| `params.*` | *absent* | the parameter contract |
| `var.*` | the workflow's | the Block's, rebuilt per call |
| `steps.*` | this Board's Steps | this Board's Steps |

**Step ids are Board-local.** Two Blocks may each have a Step called `ret`, and `{{ steps.ret }}`
means the one on the Board it is written on. Document-wide uniqueness was the alternative and it
buys nothing a Board does not already give: a Reference cannot be written except on some Board, so
there is never a spelling whose meaning depends on where the reader is standing. Board-local ids are
also what make a Block copyable between documents, which is the same portability its scope rule
already promises.

**A Block synthesizes a document-local Component Manifest**, which is why a call site costs no new
UI: the parameters are ordinary Slots in an ordinary `with:` map, and round-trip, undo and the
Template input need nothing new. The one bridge that has to be built is a `t` → field-`kind` mapping,
since a manifest field carries a UI kind and no type, while a parameter carries a type and no kind.

## `core.return`, and when a path must reach one

**Outside a Block it is an error that blocks Publish, not editing.** The root Board declares no
outputs so there is nothing to bind, and `core.end` already means "stop the workflow". It blocks
Publish rather than editing because moving a Step from a Block Board to the root is ordinary
building — `validity.ts` reserves `blocks: 'edit'` for what building cannot produce.

**A Block declaring no outputs needs no return.** Blocks used for their effects alone declare nothing
and return nothing, and the rule only bites once `outputs:` is non-empty. A return that fills only
some declared outputs needs no rule of its own either: the synthesized manifest marks them required,
so it is the ordinary missing-field diagnostic.

**A path returns if there is a return at the Board's root level, or a root-level `core.fork` whose
every branch returns.** A return inside a `core.for_each` body exits the Block early and is perfectly
legal, but it never discharges the obligation, because the list may be empty and the body may never
run. That is the same reasoning that keeps sibling branches out of scope, applied to time instead of
to paths. Steps sitting after a return on the same path can never run, and are reported the way an
unconditional Branch that swallows the ones behind it already is.

## Loop state is a Board variable

A repeated region usually has to carry something backwards — the reviewer's feedback reaching the
draft step that runs before it. Nothing positional can do that: the writer runs after the reader, so
it is not in scope. **`data.set_var` is the mechanism**, because a `var` is scoped to its **Board**
and readable anywhere on it regardless of where it was written.

A **Block** therefore declares `vars:` of its own, and `data.set_var` inside one writes those and can
never reach out of the Board it is on. That is not a second concept: it is the same rule stated once,
where "the Board" is the root for a Step in `steps:` and the Block for a Step inside one.

The alternative was iteration state declared on `core.repeat` itself, initialised and advanced by the
container, typed, and reset structurally on re-entry. It was rejected for costing a second concept
where one already works.

The cost is real and is documented rather than designed away: **a var written inside a loop survives
into the next iteration of an enclosing loop**, so a workflow that must start each pass clean resets
it explicitly. Nothing type-checks that reset.

A Block's vars are the exception, and it falls out of the contract rather than being added to fix
this: they are rebuilt on every invocation, so a Block called twice starts clean both times. A loop
whose body must not carry state across passes can therefore be extracted into a Block instead of
reset by hand — which is the same flattening move paying for itself twice.

## Deferred, not refused

A jump is **not built**, and the condition that reopens this is written down rather than left to
taste: *a jump whose target is not the head of any enclosing container*. Neither of us could name one
— revising a draft, and asking whether to fetch more, both resolve to `core.repeat` — but neither of
us proved none exists.

Deferring costs little, which is why it is a deferral and not a wall. A jump verb is **additive**: a
`core.goto` with a `target:` is a new `use` like any other, needing no migration of existing
documents. It does not disturb layout either, provided it renders as a terminal chip with a
jump-to-target affordance rather than a drawn edge — the tree walk stays correct.

The one thing that does not come back is **the promise of exact static scope**. Once the picker and
the type marking say "these are the values you can read here, and this one fits", weakening that to
"unless a jump reaches this Step" is a user-visible regression. But that price is identical whenever
it is paid — it does not compound by waiting, and waiting buys real jump cases to design against
instead of a guessed shape. What does get harder is the runner contract: Hosts shipping against
structured control flow would need a version bump to accept transfer.
