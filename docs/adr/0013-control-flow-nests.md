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
  the head of an enclosing container, which is why neither needs a jump. Its shape is below.
- **`core.return`** — publishes a **Block**'s declared outputs and ends that Block. It is the mirror
  of `core.map`: the one component whose *inputs* no manifest can declare, because they are the
  enclosing Block's `outputs:`.
- **`core.try`** — a region with a retry policy and a fallback handler. **Wrapping one Step is retry;
  wrapping a region is fallback**, so one verb serves both. Error-type matching needs no matcher of
  its own: a `core.fork` inside the handler branches on the failure. Its shape is below.

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
which the Fork's per-branch scoping already establishes. **Both bindings are the same mechanism, and
the section below says what it is** rather than leaving one defined by analogy to the other.

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

**A call site's Slots are typed by the declaration itself**, which is why it costs no new UI: the
parameters are ordinary Slots in an ordinary `with:` map, so round-trip, undo and the Template input
need nothing new.

Routing them through a *synthesized Component Manifest* was the first draft and is refused. A
manifest field carries a rendering `kind` and no type, so `slotsFor` recovers the expected type from
`FIELD_KIND_TYPES` — and that vocabulary cannot express "a Template that must produce a boolean" at
all, because `bool` holds a literal rather than a Template. Synthesizing a manifest would have
discarded exactly the half of the contract a call site exists to check. A declaration's `t` **is** the
expected type, which is what a Slot has always been: a Template together with the type it must
produce. The rendering kind is a screen's problem, derived where the screen is.

## `core.return`, and when a path must reach one

**Outside a Block it is an error that blocks Publish, not editing.** The root Board declares no
outputs so there is nothing to bind, and `core.end` already means "stop the workflow". It blocks
Publish rather than editing because moving a Step from a Block Board to the root is ordinary
building — `validity.ts` reserves `blocks: 'edit'` for what building cannot produce.

**A Block declaring no outputs needs no return.** Blocks used for their effects alone declare nothing
and return nothing, and the rule only bites once `outputs:` is non-empty. A return that fills only
some declared outputs needs no rule of its own either: every declared output is required, so it is
the ordinary missing-field diagnostic.

**A path returns if there is a return at the Board's root level, or an exhaustive root-level
`core.fork` whose every branch returns.** Exhaustive means the last branch carries no `when`: a
condition fork is first-match-wins, so one whose every branch is conditional can match none of them
and fall straight through. A return inside a `core.for_each` body exits the Block early and is perfectly
legal, but it never discharges the obligation, because the list may be empty and the body may never
run. A `core.repeat`'s body does discharge it, for the mirror-image reason, and the section below
settles why. A `core.try` discharges it only when both its regions do, which is this same
all-branches reasoning asked of a region that may or may not execute. That is the same reasoning that keeps sibling branches out of scope, applied to time
instead of to paths. Steps sitting after a return on the same path can never run, and are reported the way an
unconditional Branch that swallows the ones behind it already is.

## `core.repeat` tests after the body, and that decides four things

```yaml
- id: revise
  use: core.repeat
  until: "{{ var.approved }}"
  steps:
    - { id: draft, use: component.agent.act }
    - { id: record, use: core.set_var, with: { key: approved, value: "{{ steps.draft.ok }}" } }
```

**The body runs, then `until` is evaluated; false runs it again.** A pre-tested loop was the
alternative and is refused, because the two are not symmetric. A pre-tested loop is expressible as a
post-tested one whose body opens with a `core.fork` — a `core.return`, a future `core.stop`, or
simply nothing on the other branch. A post-tested loop is expressible as a pre-tested one only by
**duplicating the body** above the loop, which is the deduplication cost `blocks:` exists to pay
back, reintroduced by a control-flow choice. The motivating cases decide the same way: "send it back
for another revision" and "ask whether to process another batch" both have nothing to test until the
body has run once, so a pre-tested loop would make every use of one begin with a `core.set_var`
seeding a condition the user did not want to think about.

**So a `core.repeat` discharges a Block's return obligation, and a `core.for_each` does not.** The
question `alwaysReturns` asks is only ever *is this region guaranteed to run at all* — a list may be
empty, a repeat's first pass cannot be skipped. That is the same reasoning that keeps sibling
branches out of scope, applied to time rather than to paths, and it now has one answer covering both
loop verbs rather than a special case for each.

**`until:` is a structural key beside `steps:`, not a field under `with:`.** This is the wall
`blocks:` already hit from the other side: a Component Manifest field carries a rendering `kind` and
no type, so `slotsFor` recovers the expected type from `FIELD_KIND_TYPES`, and that vocabulary cannot
express "a Template that must produce a boolean" at all — `bool` holds a literal rather than a
Template. Under `with:` a condition would type-check as *text*, so `{{ steps.s2.count }}` would pass
as a termination condition and the half of the contract the field exists to carry would be gone. A
Branch's `when` sits in the same position for the same reason, and `repeatSlot` is `whenSlot` with a
different name.

**A repeat binds nothing.** `core.for_each` exposes `item`, and it can: `item` is resolved by
following the loop's `list` back to its source output, so its type is derivable from the document. A
repeat has no list. An iteration index or count would therefore be a binding nothing declares and
nothing types — and a binding with no type is the one thing the mechanism below cannot carry, because
that mechanism is an ordinary manifest output. `core.set_var` already writes a counter, which is the
trade the section on loop state makes once and should not make twice.

**Nothing bounds the iterations, and that is a decision rather than an omission.** Recursion is
refused above because it is a property of the *document* — a cycle in the call graph, decidable by
reading the file. Whether an `until` ever goes false is not: it depends on values that exist only
during a run. A `max:` written into the document would be a number Hatua could neither check nor
enforce, and a runner ignoring it would still be conformant, which is a promise the file does not
keep. **Bounding is the Host runner's obligation**: a runner imposes its own iteration ceiling and
fails the execution when it is reached, the way it already owns timeouts and retries. Hatua does not
execute, so that is the one place the contract can honestly sit.

## A container's binding is an output of the container

`core.for_each` exposes `item` and `core.try` exposes the failure. That is one idea asked twice, and
it gets one mechanism: **a container binds a name for the children it owns by declaring it as an
ordinary output of itself**, read as `{{ steps.<container id>.<k> }}`.

```yaml
- id: each
  use: core.for_each
  with: { list: "{{ steps.fetch.messages }}" }
  steps:
    - { id: send, use: component.email.send, with: { to: "{{ steps.each.item.address }}" } }

- id: guard
  use: core.try
  with: { attempts: 3, backoff_ms: 500 }
  steps:
    - { id: publish, use: component.s3.upload }
  handler:
    - { id: warn, use: component.chat.post, with: { text: "{{ steps.guard.error.message }}" } }
```

**This costs no namespace root and no bare token, which is the whole reason it is the answer.**
ADR-0014 closed the roots on the argument that "every structural idea Hatua adds is a name taken away
from users" — and a binding owned by a container is exactly such an idea. A bare `item` is the token
that argument refuses. A seventh root costs a word forever, for two bindings and every future one. A
Step id already sits one segment below `steps.`, so a binding hung off the container is a name inside
a name the user chose, and collides with nothing.

**Nesting needs no rule, and that is the test the alternatives fail.** Two nested loops are two Step
ids, so `steps.outer.item` and `steps.inner.item` are different paths and neither shadows the other.
A bare `item` would need a shadowing rule — innermost wins — and then an escape hatch for reaching
the outer one, which is a second concept and a worse one, because the reader has to count enclosing
loops to know what a word means. Here they read the id and are done.

**The failure's shape is declared where the verb is.** `core.try`'s manifest declares
`error: {message, type, step}` the way any component declares its outputs, so the type checker, the
completion list and the reference tree need no code at all for it — which is also what makes
"a `core.fork` inside the handler branches on the failure" true rather than aspirational: `error.type`
is an ordinary text member. Hatua ships the verb, so Hatua declares the shape, and every Host runner
fills it in.

**`item` is the one output whose type is not in the manifest**, and `t: item` is what says so. It is
resolved by reading the loop's `list` field as a Reference, typing that path against the loop Step's
own scope, and taking the element shape of the list it names — the `of:` the source output declared.
This is the debt this decision pays off: `t: item` was documented, reachable and resolved by nothing,
and because the checker treats `item` as matching everything, the gap surfaced not as an error but as
a type check that always passed.

Where it cannot resolve — `list` absent, not a plain Reference, naming nothing, or naming something
that is not a list — `item` stays `item` and stays permissive. Guessing `object` would be a shape
nothing declared, and every `{{ steps.each.item.<field>}}` would then type-check against members the
manifest never had. **The wrongness is reported instead**: `LOOP_LIST_NOT_A_LIST` names a loop whose
`list` has a known type that is not a list. It has to be its own rule because `list` is a `ref` field
and `FIELD_KIND_TYPES` maps `ref` to `unknown`, so the ordinary Slot check accepts anything written
there — the same "a check that always passes" failure, one layer up.

## `core.try` has two regions, and both of them are `steps:`-shaped

**The body is `steps:` and the handler is `handler:`.** `steps:` is already "the children a container
owns", and a try's body is exactly that, so the traversal covers it unchanged.

**Two `branches:` under reserved labels was the alternative and is refused.** A Branch's identity is
its `label`, which is free text the user renames — so the meaning of the document would depend on a
display name, and a region could be renamed out of existence. It also costs the schema its first
reserved word, which is the thing ADR-0014 spent a whole decision removing. A key cannot collide with
anything a user chooses, because **nothing inside a step is user-named**: `id`, `use`, `name`,
`with`, `branches`, `steps`, `until` and `handler` are a closed set the schema owns.

The cost is that a region is now a third thing a traversal can forget, beside a Branch's steps and a
loop's body. That is paid where it is cheapest: `walkSteps` and `stepLists` are the only walks, in
each language, and a `handler:` fixture in `conformance/definition/invalid/` holds both loaders to
reaching it.

**The retry policy is in `with:`, and the `until` precedent does not reach it.** `until` had to leave
`with:` because `FIELD_KIND_TYPES` has no mappable boolean at all — a condition there would have
type-checked as *text*, and half the contract would have been gone. An attempt count and a backoff
are **numbers**, and `number` is a mappable field kind, so that argument is simply absent here.
Putting them in a structural key by analogy would be copying a conclusion without its reason, and
would cost a schema key, a diagnostic and a form control that a manifest field gives for nothing.

**A `core.try` discharges a Block's return obligation only when BOTH regions return.** The body always
runs, which on its own looks like the `core.repeat` argument — but a failure part-way through the body
is precisely what a try exists to admit, and that path leaves the body unfinished and enters the
handler instead. So every path out of a try goes through the body *or* through the handler, and a
region that may skip its return leaves one of them open. That is the Fork's all-branches reasoning
asked of two regions, one of which is conditional; it is not the repeat's "guaranteed to run at all".

## What a handler's children can read

**The failure, everything above the try, and nothing from the body.**

The two regions are **siblings**, so the body cannot see the handler and the handler cannot see the
body's Steps — and this needs no code, because it is the rule that already keeps a Fork's branches out
of each other's scope. It is also the right rule for the right reason. The body failed *somewhere*;
which of its Steps completed before it did is not a property of the document, so offering them would
make scope an intersection over paths. That is the analysis this ADR refuses edges in order to avoid,
arriving through a different door.

The try Step itself is in scope **only** inside its handler, which is the one place its binding means
anything:

| reading from | sees `steps.<try id>` |
| --- | --- |
| the body | no — the body is what produces the failure |
| the handler | yes — it is the failure being handled |
| a Step after the try | no — whether there was a failure at all is a run-time fact |

The last row is the one worth stating. A Step after the try is on a path where either the body
succeeded or the handler ran, and "the failure, or nothing" is a value whose existence depends on the
run. Offering it would be the same intersection, one level out.

## Loop state is a Board variable

A repeated region usually has to carry something backwards — the reviewer's feedback reaching the
draft step that runs before it. Nothing positional can do that: the writer runs after the reader, so
it is not in scope. **`core.set_var` is the mechanism**, because a `var` is scoped to its **Board**
and readable anywhere on it regardless of where it was written.

```yaml
- id: record
  use: core.set_var
  with: { key: approved, value: "{{ steps.draft.ok }}" }
```

**`key` names a variable on the Step's own Board**, and there is no second list to fall back to —
which is what makes "a Block's `core.set_var` can never reach the workflow's variables" true by
construction rather than by a rule. A key naming nothing the Board declares is a diagnostic, and it
blocks Publish rather than editing for the reason a stale `block.<id>` does: renaming a variable is
ordinary building.

**`value` is a Slot no manifest can type**, which makes `core.set_var` the third such verb beside a
call and a `core.return`. Its expected type is the named variable's, read where the variable is
declared — so a write that does not fit is the ordinary type diagnostic every other Slot already
produces, rather than a rule of its own.

A **Block** therefore declares `vars:` of its own, and `core.set_var` inside one writes those and can
never reach out of the Board it is on. That is not a second concept: it is the same rule stated once,
where "the Board" is the root for a Step in `steps:` and the Block for a Step inside one.

The alternative was iteration state declared on `core.repeat` itself, initialised and advanced by the
container, typed, and reset structurally on re-entry. It was rejected for costing a second concept
where one already works.

## A variable's type is declared, because `core.set_var` made inference a lie

`varType` read a variable's type off the literal beside it in the document, and the Workflow tab was
built on that: *"a variable field is the one input with no type marking"*. **That stops being true
the moment a Step can write the variable.** `value: ""` infers `text`; a `core.set_var` writing
`{{ 1 + 1 }}` into it makes the builder say `text` while the runner produces a number, and every
downstream answer — the type marking, the completion list's ranking, the Publish gate — was given
against a claim about one moment in an execution rather than about the variable.

So **`vars` gains a required `t`, and an optional `of` for shape**, spelled exactly as a declaration
and a Run Context key are. The schema anticipated this in its own words — *"a list of key/value
objects rather than a map, so a `type` or `label` can be added later without a breaking change"* —
and ADR-0012's argument against inventing a second spelling for an idea the contract already has one
of holds here unchanged. A variable is still **not** a declaration: it carries a value, which no
declaration does, and its key is its own label, so three shared fields out of five is not one idea.

`value` stops being the contract and becomes what it always was: the **initial** value. That is a
gain rather than a loss, because until `t` existed there was nothing to check an initial value
*against*, and a var seeded with `{{ … }}` was unchecked in both languages.

Two alternatives were refused:

- **Constrain `core.set_var` to the inferred type and report violations.** Keeps two mechanisms for
  one idea, and makes the contract depend on how the first value happened to be written — a var
  holding an object is unexpressible without an object literal, and an expression-valued var infers
  `unknown`, so every write into it goes unchecked.
- **Weaken the inference to `unknown` for any var a `core.set_var` targets.** Makes the type marking
  depend on a Step elsewhere in the document: adding a writer silently degrades every reader, so the
  builder gets quieter exactly as the workflow gets more complicated.

The cost is paid in full and is the one ADR-0014 already priced: **every existing document, fixture
and manifest is rewritten**, and `t` is required rather than defaulted, because a fallback spelling
is a second definition of the thing on the day it was declared. It also settles a divergence the
inference had no answer for — `yaml.v3` decodes `value: 2024-01-01T00:00:00Z` into a `time.Time`
while the builder's parser leaves it a string, so the two languages typed one scalar differently and
the Go SDK carried a comment saying so. A declared type is decoder-independent.

The consequence for the builder is that the **type control**, not the value box, is what re-types
every Expression reading the variable. `CONTEXT.md`'s Slot entry and `docs/handoff.md`'s Workflow tab
are corrected to say so.

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
