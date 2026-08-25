# The canvas pans and zooms, and the viewport is chrome

The flow map was a `overflow: auto` scroll container: the drawn surface was exactly `layout`'s
totals and the region scrolled to it. That is not how a canvas tool behaves — scrollbars on a map
are a browser affordance rather than a canvas one, and there was no way to see a large workflow at
all except a screenful at a time. The canvas now **pans and zooms**, the scrollbars are gone, and a
small toolbar sits at its lower right.

## What the gestures are

| Gesture | What it does |
| --- | --- |
| Two-finger trackpad scroll | pan |
| ⌘/Ctrl + wheel, and a trackpad pinch | zoom, about the pointer |
| Space + drag, middle-button drag | pan, from anywhere |
| Drag on empty canvas | **nothing** |
| Drag on a card | moves the Step, unchanged |

**A plain drag on empty canvas does nothing, deliberately.** Grab-anywhere panning is the more
discoverable gesture and it was rejected: it is the only gesture that collides with something this
canvas will want, which is marquee selection over a region of the map. Selection already exists here
and nothing consumes it yet; when it grows a marquee, the plain drag is the gesture that belongs to
it, and taking it now would mean either retraining people later or shipping the marquee behind a
modifier for good. Panning has two homes that cost nothing — space and the middle button — and a
trackpad pans with no gesture at all.

Zoom is **about the pointer** rather than the centre of the viewport, because zooming to inspect
something means zooming to where you are looking.

## What the numbers are

**10% to 400%.** At 10% a card is 24px and the map is a minimap, which is the point of the low end
on a workflow that will not fit at any readable scale. At 400% a card is 944px, which is
magnification for someone who needs it rather than for design work.

**Zoom is continuous, and the menu snaps.** `+`, `−`, the wheel and a pinch multiply the current
scale, so it lands wherever it lands — 83%, 144% — clamped at the ends. The menu's items are
absolute: `100%` does not step, it snaps to exactly 1.0, and that is what makes it the way back to a
known state after free-form zooming. A fixed ladder was rejected for the trackpad: a pinch that
snaps instead of tracking your fingers reads as a fault.

**Fit fills the viewport, up or down.** A three-Step workflow is enlarged to fill the screen rather
than left small in the middle of it. Capping fit at 100% was the alternative and was not taken:
"fit" that refuses to fill is a control whose name does not describe what it does.

**First paint is 100%, root centred, at the top of the map** — exactly what the scroll container
showed. Opening fitted was rejected because a large workflow would then open at a scale where
nothing is readable, and the first thing anybody does is zoom back in.

## The viewport is not the document's, and not the caller's either

ADR-0001 says node positions are never stored, and a viewport is the same kind of fact one level
out: where somebody is looking is not something a **Workflow Definition** can carry, because it
would be a diff in the Host's repository every time anyone scrolled.

It is not a controlled prop either. Every other piece of chrome on `<FlowMap>` — `boardId`,
`selected`, `collapsed`, `collapsedRegions` — is a controlled trio, and each of them became one
because a second reader appeared: `views/Build` wiring the Flow tab to the canvas, or the Components
tab to an insert point. Nothing reads a viewport. So `<FlowMap>` holds it and offers two props and
not three:

- `defaultViewport` — an uncontrolled initial value, read once on mount
- `onViewportChange` — an observer

That is enough for a Host to save where somebody was and put them back there next time, and not
enough for anyone to drive the canvas into a state it cannot get itself out of. Observation alone
would have been half a feature: a Host could record a viewport and never restore one.

Opening a Block's Board resets it, because coordinates are Board-local and carrying a pan across
Boards lands in empty space.

## What it costs, and what pays for it

Removing `overflow: auto` removes something that was working for free: a scroll container brings a
focused child into view, so tabbing to an off-screen card scrolled to it. A CSS transform inside
`overflow: hidden` has nothing to scroll, so that stops.

**So focus pans the viewport.** Anything that takes focus — a card, a `+`, a region's legend, the
toolbar itself — pans the map until it is on screen. That is not an enhancement; it is the
replacement for what was lost, and without it most of a large map is unreachable without a mouse.
Zoom and pan keyboard shortcuts were considered and deferred: `⌘+` and `⌘−` are the browser's own
page zoom, and taking them means overriding a system shortcut for a gain nobody has asked for.
