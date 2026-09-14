---
about: every package under source/packages/ already carries the publish scaffolding; private:true/0.0.0 is the one flag nobody has flipped, not an unconsidered default
saw:
  - source/packages/*/package.json
  - docs/adr/0004-no-typescript-project-references.md
  - docs/adr/0003-css-ships-per-component-via-react-19.md
  - .github/workflows/ci-build.yml
  - source/apps/playground/src/host.tsx
---

Checked all 8 `source/packages/*/package.json` (document, expressions, layout, log, model, react,
schema, services). All are uniform: `"version": "0.0.0"`, `"private": true`, an `"exports"` block
pointing at `./src/index.ts`, and a `"publishConfig".exports` block pointing the same key at
`./dist/index.d.ts` / `./dist/index.js`. All eight have a `"build": "vite build"` script. None has a
`"files"` field yet.

ADR-0004 (`docs/adr/0004-no-typescript-project-references.md:20-23`) explains *why* the
`exports`/`publishConfig` split exists: "types must resolve to source in development but dist once
published... `publishConfig` addresses that directly... pnpm rewrites it at pack time." This is
written as already-decided infrastructure, not a future plan — meaning the packaging shape for
publishing was designed deliberately, well before this slice.

CI (`.github/workflows/ci-build.yml:67-84`) already runs `pnpm turbo run typecheck build` and asserts
invariants about the *published* bundle shape: no stylesheet ships beside `packages/react/dist`, and
`@layer hatua` must be inlined in `dist/index.js`, citing ADR-0003. So `dist/` output is already
built and checked in CI, just never published to a registry.

`source/apps/playground/src/host.tsx:20-38` is a live, checked example of exactly what a
publish-consuming Host is expected to do: import only the named regions it wants
(`Components, createTheme, FlowMap, HatuaProvider, Inspector, StepList, TabbedPanel, TopBar,
Workflow` from `@hatua/react`), never `<Hatua>` or `<Build>`, and the comment documents verifying
this by grepping which Rollup chunk carries each component's `hatua-*` style href.

None of the 27 ADRs in `docs/adr/` mention `private`, `npm publish`, or a registry directly (checked
via grep). So the "private: true" flag itself was never the subject of its own ADR — the surrounding
tooling (exports split, build scripts, CI dist checks, curated public re-export in
`packages/react/src/index.ts`) was clearly built with publishing in mind, but nobody has recorded a
decision to actually flip the flag. This reads as "scaffolded and waiting," not "never revisited."

No changesets config, no `npm publish` step, and no release-workflow attempt exists anywhere in
`.github/workflows/` (checked `ci-build.yml`, `ci-orchestration.yml`, `ci-preflight.yml`,
`ci-test.yml`, `dependabot-auto-merge.yml`, `gt-sync.yml`, `pages.yml` — only `pages.yml` publishes
anything, and that is the Storybook site to GitHub Pages, not packages). So there is no prior
attempt at a release mechanism to build on or avoid repeating.
