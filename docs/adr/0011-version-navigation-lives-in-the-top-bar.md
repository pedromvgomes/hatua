# Version navigation lives in the top bar

[ADR-0005](0005-hatua-owns-versioning-hosts-own-storage.md) put `version:` and `status:` in the
**Workflow Definition** and gave the **Host** a `WorkflowStore` with `listVersions` and
`loadVersion` on it. The screen never caught up: the design handoff has no versioning in it at all —
no version, no published, no archived — and its document is `{ name, slug, inputs[], vars[],
steps[] }`. So a user can hold four **Published Versions** and a **Draft**, and has nowhere to see
that or move between them.

We decided version navigation belongs in the **top bar**, beside the workflow's identity, and not in
the Flow tab.

## Why not the Flow tab

It was the plausible alternative, and it is where the difference between two versions actually
shows: the step tree is what changes. Three things rule it out.

- **A version is a property of the whole document, not of the tree.** Behind a tab, the version you
  are looking at is visible only while that tab is open. Switch to Library or Data and the canvas,
  the Inspector and the run history are all still showing version 3 with nothing on screen saying
  so. That is the same failure mode that put the canvas in the tab strip (see `layouts/README.md`):
  a thing that governs the whole screen, mounted somewhere that is sometimes not on it.
- **The panel is 304px and it scrolls.** A control that changes which document the screen is editing
  would scroll away from the list it governs.
- **Selecting a version and creating one are one subject.** **Publish**, **Release** and **Discard**
  are top-bar actions — they are what the right cluster is for, and ADR-0005 says the user decides
  only those three. Splitting "move between versions" from "make a version" across two regions puts
  the cause and the effect in different places.

## Why the top bar, specifically

The left cluster already carries identity — `workflows /`, the name, the slug — and the version is
part of the answer to "which document is this". The right cluster already carries a **Build / Runs**
segmented control, which is precedent for a control that changes what the whole screen is showing.

The bar is dense at the 1240px floor, and this adds to it. ADR-0005 pays for the slot: it retires
the handoff's **Save changes** button outright — editing autosaves — so the primary action's place
is free, and what replaces it is **Publish**.

## The shape

- A control in the **left cluster**, after the slug, reading the current version and its status:
  `v5 · Draft`. Opening it lists versions newest first from `listVersions`, paged, each with its
  status. `status` is spelled `draft | published | archived`, lowercase, as the schema spells it.
- Selecting a version that is not the Draft loads it through `loadVersion` and puts the screen in a
  **read-only** mode. That is not a new concept: ADR-0005 already says the Draft is the only mutable
  version, and a **Published Version** is immutable by definition. The escape from read-only is
  "edit", which means "open the Draft" — never "edit this version".
- **Publish** moves to the right cluster where **Save changes** was. **Release** and **Discard** sit
  with it.

## Scope

The top bar carries the version and its status, the list — paged, newest first, each row spelled as
the schema spells it — and what a row does when it is pressed.

Selecting a version loads it through `loadVersion` and puts the *whole screen* into a state where the
canvas, the step editor and the **Workflow** tab all read a document other than the **Draft**. That is
a property of every region rather than of this bar, which is why it is decided in
[ADR-0024](0024-the-editing-snapshot-describes-whichever-version-is-on-screen.md) and not here: the
editing store's snapshot describes whichever version is on screen, so every region follows without
being taught anything. What this bar owns is the list, the row, and the cluster that replaces
**Publish**, **Release** and **Discard** while a **Preview** is up.

The escape from read-only is "edit", which means "open the **Draft**" — never "edit this version".
Beside it sits **Restore**, which is the other thing a user wants from an old version and is not a
version decision at all: it replaces the **Draft**'s content and autosaves like any other edit,
leaving the **Draft**'s own `version` and `status` alone.

**Nothing is offered that does not go anywhere.** The row for the document already on screen is drawn
as current and does not select, so a workflow with one version opens a list of one unselectable row —
the honest picture, rather than a control that highlights and changes nothing. The button itself stays
whatever the history holds, because its other job is the readout, and because `listVersions` is not
fetched until the list is opened: a bar that hid itself would have to pay for that request on every
mount, on every screen carrying the toolbar, for every user who never opens it.

The **Build / Runs** segmented control is still not drawn: `ExecutionSource` says "omit entirely and
the Runs view is hidden", and there is no view to switch to.

## Three things in the design handoff our decisions have already overtaken

Recorded here because this is where the handoff and the domain model were compared.

- **`inputs[]` is retired.** A **Trigger**'s declared outputs are the workflow's parameter contract
  (CONTEXT.md, and `workflow-definition.schema.yaml` says so on `triggers`). There is no separate
  inputs section.
- **`dirty // enables Save changes` contradicts ADR-0005.** Editing autosaves. There is no Save
  button, and the flag behind it is not a thing to render.
- **Open question 2 — "are component manifests served by the host?" — is answered.** They are,
  through `ManifestSource`. Hatua invents none.
