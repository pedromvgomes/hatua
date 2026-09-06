# The editing snapshot describes whichever version is on screen

[ADR-0011](0011-version-navigation-lives-in-the-top-bar.md) put the version list in the top bar and
stopped there: selecting a row "puts the *whole screen* into a state where the canvas, the step
editor and the **Workflow** tab all read a document other than the **Draft**", which is "a property
of every region rather than of this bar". So `loadVersion` sat on the port with no reader.

We decided the editing store answers it. It holds a **Preview** alongside the **Draft**, and while
one is set the snapshot's `document`, `text` and `definition` describe the previewed version. A new
`previewing: number | null` says which. No region changes.

## Why the snapshot, and not each region

Every region already reads the open document off this one snapshot — `FlowMap`, `StepList`,
`Inspector`, `Data`, `Workflow` and `views/Build` all go through `useEditingStore`. A preview is the
same question those readers are already asking: *what is on screen*. Answering it in one place is
what makes "the whole screen follows" a property of the store rather than six independent
implementations of one rule, five of which are correct.

The alternative was a `preview` field the regions choose between — `snapshot.preview?.document ??
snapshot.document`. It leaves `document` honest, and it makes correctness depend on six call sites
each remembering the same coalesce, with a region that forgets showing the **Draft**'s steps under
the previewed version's name. That is the screen-wide change ADR-0011 declined to make, reintroduced
one region at a time.

## Why the Preview is held separately

The document under the **Draft** is not touched. Autosave, the undo history and the lease all go on
describing the **Draft**, because that is what they are about — a preview is a way of looking, not a
way of stopping, and the claim is still held for the whole of it.

Mutating the draft's document to show a preview would run the restore path through autosave: the
previewed version's bytes would be written to the **Draft** on the next quiet 800ms, which is
**Restore** happening because somebody looked. Undo would then be the only way back, and there is no
undo control on screen.

## Why `claimed` keeps its meaning

`claimed` answers "does this session hold the edit", and during a preview it does. Dropping it to
false would make `useReadOnly` and `apply()` correct with no new condition, which is the whole of its
appeal, and it would say the session had ended while the lease was still renewing: the right cluster
is drawn on `claimed`, so **Publish**, **Release** and **Discard** would disappear and be replaced by
"You are no longer editing this workflow." The snapshot would be contradicting the store about a fact
the store is the authority on.

So two guards gain one clause each, and they are the two that need it:

- `useReadOnly()` is `!claimed || previewing !== null`. A **Published Version** is immutable by
  definition (ADR-0005), so the reason is the same one already in the hook. **Every region asks
  through the hook**; one that derives read-only from the snapshot itself — `!workflow.claimed` —
  answers the older half of the question and renders a preview as editable.
- `apply()` refuses while previewing. This one is a **correctness** guard rather than an affordance:
  the command would succeed, land on the **Draft**, and be invisible, because the **Draft** is not
  what is on screen.

**Release** and **Discard** are not guarded in the store. They act on the **Draft**, which is
exactly what they claim to act on, and neither consults the checker — so there is nothing for a
guarantee to protect. What is wrong with offering them mid-preview is that the user would be
reading version 3 while pressing a button about version 6, and that is a question of what the bar
draws. It draws a cluster of its own instead: **Restore this version**, and a way back to the
**Draft**.

**Publish is different, and the difference is not about the screen.** `createValidationStore` reads
its document from *this store's snapshot* — the one this ADR has just pointed at the preview — so a
publish issued while a version is up sends the **Draft**'s bytes past a gate that judged another
document. A Draft carrying blocking diagnostics would publish because the previewed version is
clean; a clean Draft would be refused because it is not. That is [ADR-0023]
(0023-the-store-refuses-to-publish-the-button-only-says-why.md)'s guarantee failing quietly, and the
toolbar hiding the button is no answer: that ADR exists precisely because `createEditingStore` is
one import away from any Host and the document must be safe with no toolbar mounted at all. So
`publish()` refuses while a **Preview** is set, before the gate and again after its wait. Leaving
the preview is the way through and costs nothing.

The split [ADR-0023](0023-the-store-refuses-to-publish-the-button-only-says-why.md) draws still
holds — the store refuses what would corrupt the document, and the toolbar decides what is worth
offering. What this adds is that a gate reading a snapshot inherits whatever that snapshot describes,
so widening the snapshot widened the gate's blind spot with it.

## Consequences

- **The confirm before a Restore is the toolbar's, and deliberately so.** A store cannot prompt, and
  `restoreVersion` is one undoable command — so this is an affordance by the same split as above,
  not an oversight. What it asks about is **a Draft's contents**, and it is drawn exactly when there
  are some to lose.
  **The claim does not answer that question.** `releaseDraft` keeps the **Draft** for whoever picks
  it up next and `openDraft` is create-or-resume, so an unclaimed session may still hold one;
  **Publish** and **Discard** leave none, so a session that has just ended may hold nothing. Only
  the history knows, and a `draft`-status row in `listVersions` is the answer. With no such row the
  restore creates a Draft at `base + 1` and fills it, nothing is replaced, and a dialog would ask
  about a loss that cannot happen — its copy would be false in every sentence.
  A history that has not arrived or has failed counts as "yes": it cannot show that nothing would be
  lost, and one needless dialog is cheaper than one silent overwrite.
- **A preview does not need a claim.** The version list already answers while nothing is claimed and
  while the document does not project, and previewing is the same question about the same workflow.
  Restoring from a preview with no **Draft** open opens one first, which is the path **Restore**
  already has.
- **Any new claim clears the preview, and only a claim does.** `openDraft` puts a real **Draft** on
  screen, and a preview surviving it would leave the bar offering to edit a document nobody is
  looking at. A session *ending* underneath a `loadVersion` is the opposite case and must not drop
  it — a preview needs no claim, so a **Release** landing mid-load is no reason to abandon what the
  reader asked for. The store therefore counts opens separately from the generation the rest of its
  guards use, because `finish()` bumps that too and cannot tell the two apart.
- **A preview is refused while the workflow is still opening.** `commit()` publishes nothing before
  the open lands, so a preview accepted there would be held with no way to see it and would then
  surface over the **Draft** that open goes on to claim. Refusing says so at the moment of asking.
- **A version that fails to parse is never entered.** `parseWorkflow` refuses a multi-document
  source, so the preview is reported as a failed load and the screen does not move. One that parses
  but does not project is entered, and every region says so through the state ADR-0001 already gives
  them — a preview is not a promise that the **Host**'s bytes are valid.
- **`ended` moves into the snapshot with it.** `finish()` is the only thing that knows which of
  **Publish**, **Release** and **Discard** ended a session, and a toolbar reconstructing that from
  outside cannot see an ending a **Host** drove through the store directly. `dispose()` stamps
  nothing, because closing a tab is not an ending anybody chose.
