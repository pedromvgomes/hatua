# The store refuses to publish; the button only says why

[ADR-0009](0009-strict-expression-semantics.md) says errors block **Publish** and warnings block
nothing. Everything needed to enforce that was already in place except the one line that joins it up.
`schemas/definition-diagnostics.yaml` declares `blocks:` per code and its header calls that part of
the cross-language contract, because "a code that blocks Publish in TypeScript and merely informs in
Go would let a workflow publish from one builder and not another". `validity.ts` drops expression
warnings before they can become a `Diagnostic`, saying in as many words that its pass "exists to mark
cards and gate Publish". `ValidationStore` computes `all` and its docstring notes that "the toolbar
counts them".

And then `EditingStore.publish()` took the current text and called the port.

> **`publish()` refuses.** A document that does not project is never published, and neither is one
> carrying a blocking diagnostic. The toolbar's job is to say why, not to decide.

## Why not the button

Disabling the control is the cheap answer and it is an **affordance**, which is a different kind of
thing from a **guarantee**. They fail differently, and that is the whole argument: an affordance can
be absent — a Host composes its own toolbar, or writes its own Publish control, or mounts
`<TopBar>` nowhere at all — and the document must still be safe. `@hatua/services` is a published
entry point, so `createEditingStore` is one import away from any Host that wants it.

The maintenance shape is worse than the immediate hole. A rule that lives in a button is
re-implemented by the next surface that grows a Publish control, and forgotten by the third.

Both ship. The store refuses, and the toolbar disables nothing.

## Why the button is not disabled either

It stays live and **answers**. Pressing Publish on a workflow with problems opens the list of them,
each row navigating to the thing it is about where there is something to navigate to.

`units/SegmentBar` already makes this argument for extraction over a **Return**: a control that
disappears, or that greys out without saying why, "would leave the reader with no way to learn what
they did", and `aria-disabled` is used there rather than `disabled` precisely so the explanation is
reachable by the readers who most need it. A gate the user cannot interrogate is a gate they route
around by guessing.

The count is shown before anything is pressed, so the answer is available without the click too.

## The two layers, and why the split is real

**A document that does not project is refused unconditionally.** The editing store already computes
`definition` and `invalid` in `commit()`, so this costs no dependency, no injection and no wiring. It
holds for every Host in every configuration, including one that builds the store by hand. Publishing
something that is not a **Workflow Definition** is indefensible under any reading.

**The diagnostic gate is injected**, because it genuinely needs the catalogue, and a Host may
legitimately have supplied none. Confining "can be absent" to the half that unavoidably depends on a
port is what stops the floor from being unwirable.

## What happens when validation cannot answer

| State | Publish |
| --- | --- |
| `definition` is null | **refused** |
| catalogue still arriving (`ready: false`) | **waits** |
| `connections: 'pending'` | **waits** |
| `connections: 'undescribed'` | **proceeds**, two codes unchecked |
| no `ValidationStore` at all | **proceeds**, floor only |

The two `waits` follow `validation.ts`, which already says of `pending` that "it will, so a Publish
gate may wait" — so the gate is `async` and the waiting is its business rather than `publish()`'s.

**The wait is bounded, and only this half of it is.** "It will reply" is true of a Host that replies;
one whose manifest fetch hangs leaves the catalogue loading for the life of the page, and a gate
waiting on that never answers — so the press is never heard back from and every control that a press
disables stays disabled. Giving up costs nothing: no claim is spent and the port is never called while
the gate waits. Waiting on `port.publish` is different in kind — the write is in the Host's hands, and
no local timer can un-make it — so that wait stays unbounded.

**A deadline that runs out with nothing checked refuses; it does not narrow.** Whether the catalogue
arrived is what says the rules ran: a wait that expires with only the Connections outstanding leaves
exactly the two codes `undescribed` leaves, and narrows. A wait that expires with no catalogue leaves
a list that ran nothing, and that is the one that must not be mistaken for a clean workflow. The
difference is what kind of silence it is. `undescribed` is a question nobody
can ever answer, so proceeding is the only alternative to never publishing at all. A wait that ran out
is a question that has not been answered *yet* — and an unchecked workflow's diagnostic list is empty,
which is indistinguishable from a clean one at the only call site there is. So the gate rejects, the
press is answered, and asking again is the way through. A Host that is merely slow is the reachable
case rather than the exotic one: the catalogue fetch starts when the bar mounts, so a cold endpoint
and a user who presses **Publish** inside the window is all it takes.

The two `proceeds` follow [ADR-0022](0022-validation-may-be-told-what-only-the-host-knows.md): an
absent answer **narrows** the check and never withholds it. The alternative is that a Host which
wired no `ConnectionSource` — a correct configuration, not a broken one — can never publish
anything, which is a worse failure than an unchecked code. The last row is the same rule at its
limit and is worth stating plainly: **a Host that serves no `ManifestSource` publishes against the
floor alone**, because with no catalogue every Step is an unknown component and the gate has nothing
to say that is not noise.

## Why the gate is late-bound

`ValidationStore` is built **from** `EditingStore` — it subscribes to it — so `publish()` cannot
simply read it.

The knot unties on a distinction: validation needs the editing store *continuously*, while publish
needs validation *once, at click time*. Late-binding the half that is only needed later is enough,
and a stable object reading a ref is the ordinary React expression of it.

The ref is not decoration. `HatuaProvider` keys the editing store on `[workflowSource, workflowId]`
and nothing else, deliberately: rebuilding it disposes the lease and re-claims the **Draft**. Any
wiring that puts the validation store in that dependency list makes *swapping the connection
describer reopen the document*.

That single constraint rules out the three obvious alternatives:

- **A `createWorkspace(ports, workflowId)` factory** owning the wiring internally. It reads well and
  collapses four independent memo boundaries into one — the lease hazard, arrived at from the other
  side.
- **Injecting the manifest and connection stores and re-running `validateDefinition` at publish
  time.** This one really does avoid the cycle, since neither store depends on editing. It still hits
  the lease hazard, and it writes the `indexManifests` / `manifestsIn` / `contextKeysIn` composition a
  second time — two answers to a question `createValidationStore` exists to answer once.
- **`publish(blockers)` taking them as an argument.** Caller-supplied is caller-omittable, which is
  the guarantee this ADR exists to establish.

Reading the memoised store also buys something the recomputation would not: publish and the canvas
markers can never disagree about what is wrong, because there is one answer.

## Consequences

- **`publish()` rejects rather than returning a result.** `PublishBlocked extends Error` carries the
  diagnostics, modelled on `ExpressionError` and for its stated reason — it reports every failure
  together, because "a user fixing one field at a time is a user running the workflow five times to
  find five mistakes". A `Result` return would make every `await store.publish()` wrong, and
  rejection is already how `requireToken()` refuses.
- **The gate is an affordance-free guarantee.** Nothing about it requires a toolbar, and a Host that
  never mounts one still cannot publish a broken workflow.
- **A user-initiated resume is not the retry ADR-0005 forbids.** `halt()` refuses to retry
  automatically, correctly: a Host that has said no "will not become true again by asking harder".
  But `reopen()` — the only exit that existed — calls `openDraft()`, which discards the in-memory
  document that [ADR-0005](0005-hatua-owns-versioning-hosts-own-storage.md) promises to keep. So
  `resumeSaving()` clears the halt and re-enters the schedule on the held token. One press, chosen by
  the person whose work it is, is a different act from a timer.
- **The conflict a Host reports is rendered, not diagnosed.** `WorkflowStore.publish` rejects with a
  plain `Error` and carries no code, so Hatua cannot tell "someone else published" from "your claim
  was taken". Both surface as the Host's own message with a way to try again. A typed conflict on the
  port would change a contract the Go SDK shares and is not decided here.
