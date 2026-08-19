# layouts

The regions a screen is assembled from — `TopBar`, `Library`, `FlowMap`,
`Data`, `Inspector`, and the `TabbedPanel` that arranges three of them.

Each is exported individually from `@hatua/react`, and each mounts alone. That
is the whole point of the tier: `views/Build` is a convenience, and a Host that
wants its own arrangement imports the regions, wraps them in `<HatuaProvider>`
and puts them wherever it likes. `apps/playground/src/host.tsx` is that Host,
and `layouts/regions.test.tsx` mounts every region outside `<Build>` so the
container cannot quietly become required.

**Rule:** these are the components that may call `@hatua/services`. `Library` is
the first that does: it subscribes to the manifest store through
`useSyncExternalStore` and holds nothing but the text in its filter box. The
editing store arrives later; `TabbedPanel` still owns only which tab is open,
which is chrome state and not in the Workflow Definition.

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

What regions still send *out* is props. `Library` takes an optional `onSelect`;
it does not add the Step itself, because adding one needs the editing store. A
region that emits an event stays mountable alone; a region that requires a
handler does not, so every such prop is optional.

## Two vocabularies, reconciled

This file used to name the regions `TopBar, StepList, FlowMap, Inspector,
RunDrawer`, which predates the three-tab plan. What survives:

| Was | Now | Why |
| --- | --- | --- |
| `TopBar` | `TopBar` | Unchanged: the toolbar. |
| `StepList` | *retired* | It was the tree as a list beside the map. The tree is the map now, and the three tabs are Library, Flow and Data — there is no fourth panel for it to be. |
| `FlowMap` | `FlowMap` | The canvas, and the region behind the **Flow** tab. |
| `Inspector` | `Inspector` | The step editor. |
| `RunDrawer` | *moved* | It belongs to `views/Runs`, not to `Build`. A **Workflow Execution** is read-only history; nothing in the designer edits one. |
| — | `Library`, `Data` | New: the other two tabs. |

The tab labels and the component names are deliberately not forced into one
list. **Flow** is a label a user reads; `FlowMap` is the region that renders it,
and it is called that because a Host mounting it outside the tab strip is not
mounting "a tab". `Library` and `Data` happen to match their labels because
nothing better presented itself.

`TabbedPanel` is chrome and owns no data, which makes it the odd one in a tier
described as "the regions that own their data". It lives here rather than in
`primitives/` because it exists for exactly one screen: it takes `{id, label,
content}` and knows nothing else, but a primitive is a component we owe a
general API to, and this is not one.
