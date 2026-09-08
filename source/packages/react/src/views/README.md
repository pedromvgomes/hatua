# views

Compose layouts only. `Build`, `Runs` and `Text`, plus the exported `<Hatua>`
control.

Three views, because there are three answers to *what is the whole screen
showing* — the designer, the document as YAML, and one **Workflow Execution**
drawn against the version it references. One segmented control in the toolbar
switches between them, `<Hatua>` holds which one is up, and the bar owns none of
them (ADR-0011). **Runs** is only reachable where the Host serves an
`ExecutionSource`; **Text** always is, because the store always has text.

**Each view owns what is on screen while it is mounted.** `Runs` sets a
**Preview** when a run is opened and drops it on the way out, which is why the
three are mounted one at a time rather than hidden: a hidden view is one still
holding it. `Text` asks before the screen changes under text the document could
not take, because a region cannot refuse to be unmounted and `<TextMode>` is
right not to try.

`<Hatua>` mounts the provider and renders one of the three, opening on `Build`.
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
