---
about: the exports/publishConfig split every publishable package carries is deliberate packaging scaffolding from ADR-0004, and CI asserts the published dist/ shape
saw:
  - source/packages/*/package.json
  - source/sdk/js/package.json
  - docs/adr/0004-no-typescript-project-references.md
  - docs/adr/0003-css-ships-per-component-via-react-19.md
  - .github/workflows/ci-build.yml
  - .github/workflows/release.yml
  - source/apps/playground/src/host.tsx
---

The nine published packages (`source/packages/{document,expressions,layout,log,model,react,schema,services}`
and `source/sdk/js`) are uniform: `"version": "0.1.0"`, no `private` field, `"files": ["dist"]`,
`"publishConfig"` carrying `access: public`, a `repository` object naming the package's directory,
an `"exports"` block pointing at `./src/index.ts`, and a `"publishConfig".exports` block pointing
the same key at `./dist/index.d.ts` / `./dist/index.js`. Each has a `"build": "vite build"` script.

ADR-0004 (`docs/adr/0004-no-typescript-project-references.md:20-23`) explains *why* the
`exports`/`publishConfig` split exists: "types must resolve to source in development but dist once
published... `publishConfig` addresses that directly... pnpm rewrites it at pack time." The packaging
shape is deliberate infrastructure, not an accident of scaffolding.

CI (`.github/workflows/ci-build.yml:67-84`) runs `pnpm turbo run typecheck build` and asserts
invariants about the *published* bundle shape: no stylesheet ships beside `packages/react/dist`, and
`@layer hatua` must be inlined in `dist/index.js`, citing ADR-0003. Those assertions gate the pull
request; `.github/workflows/release.yml` runs on the tag and does not repeat them, so a tag pushed at
a commit whose PR checks never completed is not covered by them.

`source/apps/playground/src/host.tsx:20-38` is a live, checked example of what a publish-consuming
Host does: import only the named regions it wants (`Components, createTheme, FlowMap, HatuaProvider,
Inspector, StepList, TabbedPanel, TopBar, Workflow` from `@hatua/react`), never `<Hatua>` or
`<Build>`, with a comment documenting how this was verified by grepping which Rollup chunk carries
each component's `hatua-*` style href.
