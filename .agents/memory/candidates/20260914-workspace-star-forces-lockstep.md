---
about: workspace:* on every internal @hatua/* dependency rewrites to an exact pinned version at pack time, which forces near-lockstep publishing across the schema-rooted dependency graph
saw:
  - source/packages/*/package.json
  - source/pnpm-workspace.yaml
---

Grepped all `package.json` `dependencies`/`devDependencies` under `source/packages/*/` for
`workspace:`. Every cross-package dependency uses the bare `workspace:*` protocol (not `workspace:^`
or `workspace:~`). No `.npmrc` anywhere in the repo sets `save-workspace-protocol` to anything other
than pnpm's default, so pnpm's default publish-time rewrite applies: `workspace:*` is replaced with
the dependency's exact current version, not a caret range.

The dependency graph itself (read straight from each package.json's `dependencies`):

- `@hatua/schema` — no internal deps (the root)
- `@hatua/document`, `@hatua/expressions` — depend on `schema`
- `@hatua/layout`, `@hatua/model` — depend on `schema` (+`model` also depends on `expressions`,
  `document`)
- `@hatua/services` — depends on `schema`, `document`, `model`, `layout`, `expressions`, `log`
- `@hatua/react` — depends on all seven: `document`, `expressions`, `layout`, `log`, `model`,
  `schema` and `services`

Because the rewrite is exact-pin rather than range, publishing `@hatua/schema` at a new version and
independently leaving `@hatua/react` unpublished means every consumer installing the already-published
`@hatua/react` gets pinned forever to the older `@hatua/schema` it was packed against — there is no
semver range to let a bugfix in `schema` flow to consumers of `react` without a new `react` release.
Independent (per-package) semver is possible in principle but every publish of a "leaf" package
(schema, log) that other packages depend on obligates a republish of everything downstream of it if
consumers are meant to receive the update, which in practice is everything except the two leaves
plus `react`'s siblings, since `react` sits at the top of the graph depending on nearly all of them.
This is a real constraint on the "independent versioning" question, not a decided policy — nothing
in the ADRs discusses package-version lockstep.

`docs/adr/0028-one-tag-one-version.md` now records the decision this forces — one tag sets one
version across all nine, and only `@hatua/react` and `@hatua/sdk` are supported surfaces — quoting
a packed manifest as evidence. What is not in the ADR, and is the reason this may still be worth a
note, is the mechanism: the rewrite is pnpm's default for the bare `workspace:*` protocol, and no
`.npmrc` in the repo sets `save-workspace-protocol` to change it.
