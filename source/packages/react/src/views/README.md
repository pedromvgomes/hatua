# views

Compose layouts only. `Build` and `Runs`, plus the exported `<Hatua>` control.

`<Hatua>` mounts the provider and renders `<Build>`. It takes **no children**:
there are two ways to embed and only two — write `<Hatua>`, or import the
regions from `layouts/` and arrange them inside your own `<HatuaProvider>`. A
children slot would be a third, sitting between the two and answering neither
question well. See `Hatua.tsx` for the longer version.

`Build` takes no slot props either, for the same reason: swapping one region is
what importing the regions is *for*.
