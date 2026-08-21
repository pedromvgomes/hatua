# views

Compose layouts only. `Build` and `Runs`, plus the exported `<Hatua>` control.

`<Hatua>` mounts the provider and renders `<Build>`. It takes **no children**:
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
