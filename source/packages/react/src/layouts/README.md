# layouts

The regions a screen is assembled from — `TopBar`, `StepList`, `Library`,
`Data`, `FlowMap`, `Inspector`, and the `TabbedPanel` that arranges the middle
three.

`views/Build` puts them in the shape the design handoff specifies: the toolbar
across the top, then three columns that are all on screen at once.

```
+-------------------------------------------------------------+  TopBar, 56px
| TabbedPanel      | FlowMap                    | Inspector    |
| 304px            | 1fr                        | 404px        |
| Flow/Library/Data| the canvas                 | the editor   |
+-------------------------------------------------------------+
                     min-width 1240px; below that the screen
                     scrolls sideways rather than collapsing
```

Each is exported individually from `@hatua/react`, and each mounts alone. That
is the whole point of the tier: `views/Build` is a convenience, and a Host that
wants its own arrangement imports the regions, wraps them in `<HatuaProvider>`
and puts them wherever it likes. `apps/playground/src/host.tsx` is that Host,
and `layouts/regions.test.tsx` mounts every region outside `<Build>` so the
container cannot quietly become required.

**Rule:** these are the components that may call `@hatua/services`. `Library`
was the first: it subscribes to the manifest store through `useSyncExternalStore`
and holds nothing but the text in its filter box. `StepList` is the second, and
it subscribes to the editing store the same way — the parsed **Workflow
Definition** in, a tree out, and every structural change back through the store
as a command against the document (ADR-0001).

`TabbedPanel` still owns no data. It gained a controlled `tabId`, which is a
different thing: the tab that is open is still chrome, and lifting it into a
caller is what lets `views/Build` open the Library when an insert point is
chosen in the Flow tab. None of it reaches the document.

`views/Build` reaches `@hatua/services` as well, for exactly one thing: the
`addStep` command it applies when the Library and the Flow tab are wired
together. It reads nothing — it does not subscribe to the store, because a
re-render of the whole screen on every keystroke is the opposite of why the
store is external.

`HatuaProvider` reaches `@hatua/services` too, and is the one component outside
this tier that may. It is not a region — it is the composition root, and what it
does with the package is build the stores from the Host's ports, not read them.
See `theme/HatuaProvider.tsx`.

## Where a region's data comes from

Not from props. `Library` takes no manifests, `Inspector` will take no Step, and
that is forced rather than chosen: `apps/playground/src/host.tsx` mounts each
region bare and `regions.test.tsx` renders every one of them with nothing above
it, so a required data prop would break both. Everything a region reads arrives
through `<HatuaProvider>` — the Host's ports go in, and the stores that read
them come out.

What regions still send *out* is props. `Library` takes an optional `onSelect`
and `StepList` an optional `onInsert`; neither adds the Step. That is not a
missing feature — it is the only place the two halves can meet. `StepList` knows
where a Step would go and nothing about the catalogue; `Library` knows the
Components and nothing about the tree. Something above both has to introduce
them, and `views/Build` is that something.

A region that emits an event stays mountable alone; a region that requires a
handler does not, so every such prop is optional. `apps/playground/src/host.tsx`
is the proof: it mounts the Flow tab with no `onInsert` at all, and the region
simply renders no insert controls — while removing and reordering still work,
because neither needs a catalogue.

## What each region is

| Region | What it is |
| --- | --- |
| `TopBar` | The toolbar. |
| `StepList` | The tree as a dense, ordered list, and the region behind the **Flow** tab. |
| `FlowMap` | The canvas: the same tree as a map of nodes and connectors, filling the middle column. Not a tab. |
| `Inspector` | The step editor. |
| `Library`, `Data` | The other two tabs. |

A run drawer belongs to `views/Runs`, not to `Build`. A **Workflow Execution**
is read-only history; nothing in the designer edits one.

### The list and the map are both on screen

They are not redundant, and neither replaces the other. The list is scannable at
a glance in a long workflow, is where a Step is dragged from, and makes the
insert points unambiguous; the map shows structure — branches, joins, what runs
in parallel — which no list does well. The tree sits in the side panel behind
the **Flow** tab and the map fills the middle, so no fourth panel is needed for
either.

Mounting the canvas as one of the three tabs is the arrangement to avoid: it
would be visible only while that tab was open and never beside the panel it is
edited from, and a canvas you have to leave the library to look at is not a
canvas.

### Names and labels

The tab labels and the component names are deliberately not forced into one
list, but they must not *collide*: **Flow** is a label a user reads and it opens
`StepList`, while `FlowMap` is the region beside it, named `Flow map` as a
landmark. Two landmarks answering to "Flow" is exactly how the canvas ended up
in the tab strip. `Library` and `Data` match their labels because nothing better
presented itself.

`TabbedPanel` is chrome and owns no data, which makes it the odd one in a tier
described as "the regions that own their data". It lives here rather than in
`primitives/` because it exists for exactly one screen: it takes `{id, label,
content}` and knows nothing else, but a primitive is a component we owe a
general API to, and this is not one.

## Column edges belong to the container

No region draws its own divider. `Build` puts the borders on the wrappers that
place them, because a region that drew its own edge would only sit correctly in
a container shaped like this one — `apps/playground/src/host.tsx` puts the
Inspector on the *left*, where a `border-inline-start` of its own would be a
line down the middle of nothing.
