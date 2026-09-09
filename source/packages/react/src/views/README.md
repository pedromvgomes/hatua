# views

Compose layouts only. `Build` and `Runs`, plus the exported `<Hatua>` control.

Two views, because there are two answers to *which document is on screen* — the
one being edited, and one **Workflow Execution** drawn against the version it
references. One segmented control in the toolbar switches between them, `<Hatua>`
holds which one is up, and the bar owns neither (ADR-0011). **Runs** is only
reachable where the Host serves an `ExecutionSource`, and with no port the whole
control goes rather than one segment.

**Text Mode is not a third view.** The map and the text are two ways of editing
one document (ADR-0001), so each view holds for itself whether its column draws
the map or the text, and `units/TextToggle` sits on the column — which is what
makes "the document did not change" visible rather than a rule (ADR-0026). In
`Build` the toggle takes the side panel and the step editor with it, because each
of them writes to the document the text box is holding and would replace what was
typed; in `Runs` they stay, because nothing there writes. The rule is *hide what
cannot act*.

`views/leavingText` is the guard both share: `<TextMode>` reports that it is
holding text the document could not take, and the view asks before the screen
changes — a region cannot refuse to be unmounted and is right not to try. Two
ways out of the text (the toggle, and the bar) times two views is why it is not
written inline.

**Each view owns what is on screen while it is mounted.** `Runs` sets a
**Preview** when a run is opened and drops it on the way out, which is why the
two are mounted one at a time rather than hidden: a hidden view is one still
holding it.

`<Hatua>` mounts the provider and renders one of the two, opening on `Build`.
It takes **no children**:
there are two ways to embed and only two — write `<Hatua>`, or import the
regions from `layouts/` and arrange them inside your own `<HatuaProvider>`. A
children slot would be a third, sitting between the two and answering neither
question well. See `Hatua.tsx` for the longer version.

`Build` takes no slot props either, for the same reason: swapping one region is
what importing the regions is *for*.

`<Hatua>` does take `ports` — the Host's implementations of the seams Hatua
reads, forwarded straight to `<HatuaProvider>`. That is not a third mechanism
creeping in: it is the one question Hatua cannot answer for itself. Hatua never
invents a Component, so a designer given no `ManifestSource` has an empty
catalogue by definition, and both ways to embed have to say where the manifests
come from. The regions themselves still take none of it.
