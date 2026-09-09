# A run is a Preview with a reason

[ADR-0005](0005-hatua-owns-versioning-hosts-own-storage.md) gave the **Host** an `ExecutionSource`,
and it has sat on the port with no reader ever since: `listExecutions` paged, `loadExecution`
returning a **Workflow Execution**. `workflow-execution.schema.yaml` decides the shape and says the
thing that governs everything below — an execution **references** its definition by version rather
than embedding it, "because painting a three-week-old run against today's definition would put
durations on steps that did not exist and silently drop steps that did".

So drawing a run means putting a document that is not the **Draft** on screen, resolved through
`loadVersion`. That is precisely what a **Preview** already is
([ADR-0024](0024-the-editing-snapshot-describes-whichever-version-is-on-screen.md)).

We decided a run **is** a Preview, and that the Preview gains a reason for being set.

## Why not a second document

The alternative is a runs store holding its own `WorkflowDocument`, with the **Runs** view's regions
reading that instead of the editing snapshot. It is the shape ADR-0024 rejected, one level up: every
region would coalesce — `run?.document ?? snapshot.document` — and correctness would depend on each
call site remembering, with a region that forgets drawing the **Draft**'s Steps under a run's status
marks. Two ways to put a not-the-Draft document on screen is the thing to avoid, and this is the
second way wearing a run's clothes.

Reusing the Preview instead means no region is taught anything. `useReadOnly()` is already true, so
`<FlowMap>` already draws no `+` and no `SegmentBar`; `apply()` already refuses; `publish()` already
refuses; the undo stack already reports nothing. Every one of those was decided for a previewed
version and is exactly what a run needs.

## Why the reason, and not a bare version number

`previewing: number` says *which* version, which is all the version list ever needed. It cannot say
*why*, and two readers need to know.

- **The top bar.** The Preview cluster is **Restore this version** and a way back to the **Draft**.
  Drawn over a run it offers to restore a version the reader did not choose and never saw a row for,
  captioned as though they had gone looking for it. What a run wants there is the run's own cluster.
- **The checker.** `createValidationStore` reads this store's snapshot, so pointing the snapshot at a
  run's version points the checker at it too — see below.

So `previewing` carries what was asked for: the version, why, and for a run the `runId`. It stays one
field with one meaning — *what is on screen instead of the Draft* — and `previewing !== null` goes on
answering every question that only wanted the boolean.

## The checker narrows for a run, and only for a run

A run's card already carries a mark: succeeded, failed, skipped. A `COMPONENT_UNKNOWN` beside it is a
second mark in the opposite tense — *this failed three weeks ago* next to *this will fail if you
publish it* — reported against a document that is history, by a catalogue that has moved since. It
names nothing the reader can go and fix.

So `createValidationStore` answers `ready: false` while a run is on screen, which is the narrowing
[ADR-0022](0022-validation-may-be-told-what-only-the-host-knows.md) already lets it do when it cannot
answer rather than when the answer is "nothing is wrong". An unchecked workflow and a clean one must
not look the same, and under a run neither is what is being claimed.

A **Preview** chosen from the version list keeps its diagnostics. That version is **Restore**'s
candidate, so *what is wrong with it* is a question the reader can act on — and the count in the bar
is already not drawn during a preview, so the markers on the canvas are the only reader either way.

## Consequences

- **The Runs view owns the Preview for as long as it is mounted.** Mounting it leaves any version
  chosen from the list; unmounting leaves the run's. The two never coexist, and neither leaks into
  the other view — a run's version drawn under **Build** would carry no status marks and would be
  captioned as an ordinary preview of a version nobody picked.
- **Before a run is picked there is no map.** A run is drawn against the version it references, and
  with no run there is no version — so the middle column is a placeholder rather than `<FlowMap>`.
  Drawing the **Draft** there would answer "which run am I looking at" with a document that is not a
  run at all.
- **The run's version can be read as text, and no rule was needed to allow it.** The toggle that
  swaps a column between the map and the text belongs to the column and not to the toolbar
  (ADR-0026), so pressing it in the **Runs** view draws the version the run references as YAML —
  read-only, because `useReadOnly()` already says so. Nothing about which document is on screen
  changed, which is precisely why there is nothing to decide.
- **The segmented control is drawn only where it goes somewhere.** `ExecutionSource` says "omit
  entirely and the **Runs** view is hidden", and that stays the rule: the port is absent, the segment
  is absent. Its methods are not individually optional — a Host that can list runs and not load one
  has a broken implementation, not a reduced one, and pushing that into the type would make every
  reader ask twice. Which view is up is chrome, lifted from the bar the way `<TabbedPanel>` lifts
  which tab is open.
- **Run status reaches the map through a store, not a prop.** `layouts/README` draws the line: chrome
  comes in as props, data comes from `<HatuaProvider>`. Per-step status is data — it is the whole of
  what the Host handed over — so `<FlowMap>` subscribes to the execution store and marks cards when a
  run is open, and marks nothing when there is no store to ask.
- **The marks do not change the geometry.** A card is `nodeHeight` or `nodeHeightWithMeta` and which
  one is decided by the manifest alone, so the map stays a function of the document and the
  catalogue. A run paints inside the card it was handed and adds no row.
- **A Step under a loop shows the worst of its passes, and the passes are in the pane.** `iterations`
  exists because a flat `stepId -> status` list cannot say "succeeded 23 times and failed once", and
  a card that is one shape cannot say it either. So the card says failed, and how many passes there
  were; the run pane lists them.
- **Mounting the toolbar still claims the edit.** `<TopBar>` calls `open()`, and both views mount it,
  so switching to **Runs** inside the designer does not release anything and does not need to — the
  claim was taken to build with. A Host that wants a run viewer and no claim mounts the regions bare
  without the toolbar, which is what `ports.ts` means by "a Host that mounts only the run viewer must
  not take a lease on a workflow nobody is editing".
- **Totals are derived and were already written.** `@hatua/model`'s `totals` and `pivot` sum the
  per-step values using the `measure` / `dimension` roles the manifests declare, which is why the
  schema refuses a run-level metadata block: runners each inventing a summary shape is a Runs view
  that renders none of them generically.
