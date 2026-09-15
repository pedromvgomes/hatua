# Never hand-edit the `version` field in a published `@hatua/*` manifest

The nine published packages — `@hatua/document`, `@hatua/expressions`, `@hatua/layout`,
`@hatua/log`, `@hatua/model`, `@hatua/react`, `@hatua/schema`, `@hatua/services` and
`@hatua/sdk` — move in lockstep: one release tag sets the same version across all of them.
This is not a convenience, it is forced by the dependency graph: every internal dependency
in the workspace is a bare `workspace:*`, which pnpm rewrites to an exact pinned version at
pack time. A package published with a version the others don't carry strands whoever
depends on it. See `docs/adr/0028-one-tag-one-version.md`.

## Applies to

The `version` field in `source/packages/*/package.json` and `source/sdk/js/package.json`.

## Example

```
✗ bump source/packages/model/package.json to "0.1.1" to publish a fix on its own
✓ merge the fix; a release tag sets the version for all nine packages at once, and
  .github/workflows/release.yml refuses to publish if any manifest disagrees with the tag
```
