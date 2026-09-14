---
about: '@hatua/react''s public API is already decided by ADR-0003 and enforced by a chunk-membership check, not an open question for the publishing slice'
saw:
  - docs/adr/0003-css-ships-per-component-via-react-19.md
  - source/packages/react/src/index.ts
  - source/apps/playground/src/host.tsx
---

ADR-0003 (`docs/adr/0003-css-ships-per-component-via-react-19.md:24-29`) states the rule directly:
"The parts are individual named exports, never properties of `Hatua`." It rejects the alternative
(`<Hatua.Canvas />`) on the grounds that reaching a static property forces evaluating the function it
hangs off, so a Host that wants one region would still pull in the whole designer. The ADR also notes
`@hatua/react/styles.css` is deliberately *not* exported — "a meaningful one has to aggregate every
component's CSS... exporting the path today would resolve to a file the build never emits."

`source/packages/react/src/index.ts` is the concrete current surface: layout regions
(`Components, Data, FlowMap, Inspector, RunList, RunStep, StepList, TabbedPanel, TextMode, TopBar,
Workflow`), primitives (`Button, ConfirmDialog, Input, Select, Toast, Toggle, Tooltip`), theming
(`createTheme, HatuaProvider`), and the two composed views (`Build`, `Hatua`, `Runs`) are all named
exports at the top level. Types from `@hatua/model`, `@hatua/schema` and `@hatua/services` are
re-exported too, with a comment explaining why (`src/index.ts:1-16`): a Host implementing a port or
holding a `Segment`/`BoardId` should not have to install those packages directly just to name the
type it's handed.

`source/apps/playground/src/host.tsx:20-38` is a live enforcement of the boundary: a comment explains
the page intentionally never imports `<Hatua>` or `<Build>`, and documents verifying via
`grep -l hatua-build dist/assets/*.js` that the container's per-component style href does not leak
into the host page's chunk. This is checked per-page-not-per-entry-chunk because Rollup hoists
`<Hatua>` into its own shared chunk otherwise.

So for the publishing slice: what @hatua/react exports today (named regions + primitives + theme +
composed views, no `Hatua.X` properties, no aggregate stylesheet) already matches the intended public
surface described in ADR-0003. The open question is not "what should the API be" but "does anything
under `src/` outside `index.ts`'s re-export list need hiding via `exports`/`files`" — units/, hooks not
re-exported, and internal layout helpers are reachable today only because nothing yet restricts deep
imports (no `files` field, no `exports` subpath restriction).
