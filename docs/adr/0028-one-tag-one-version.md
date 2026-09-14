# One tag sets one version

Nine packages go to npm — `@hatua/document`, `@hatua/expressions`, `@hatua/layout`, `@hatua/log`,
`@hatua/model`, `@hatua/react`, `@hatua/schema`, `@hatua/services` and `@hatua/sdk` — plus the Go
module. A single tag sets the same version across all of them, and only **`@hatua/react`** and
**`@hatua/sdk`** are supported surfaces. The other seven are on the registry because
`@hatua/react`'s build treats them as externals rather than bundling them; nobody installs
`@hatua/model` and gets a contract.

## Why not version them independently

Because the lockstep is not a convenience, it is what the dependency declarations already force.
Every internal dependency in this workspace is a bare `workspace:*` — `@hatua/react` on its seven,
`@hatua/services` on its six, `@hatua/sdk` on its three, and so down to `@hatua/schema`, which
depends on none. pnpm rewrites that specifier at pack time, and what it writes is an **exact pin**,
not a range. `@hatua/react`'s packed manifest reads:

```json
"dependencies": {
  "@hatua/expressions": "0.1.0",
  "@hatua/schema": "0.1.0",
  "@hatua/log": "0.1.0",
  "@hatua/model": "0.1.0",
  "@hatua/services": "0.1.0",
  "@hatua/layout": "0.1.0",
  "@hatua/document": "0.1.0"
}
```

So publishing one package on its own strands every Host that has the ones around it. A fix to
`@hatua/model` published alone is a version no installed `@hatua/react` can reach: the manifest a
Host resolved names `0.1.0` exactly, semver has no room above it to move into, and the patch sits
on the registry unreachable by the only package that imports it. The Host's recourse is to upgrade
`@hatua/react` — which is the lockstep, arrived at through a support ticket instead of a tag.

Ranges would make independent versioning possible, and buying that is the trade this decision
refuses. `workspace:*` is what makes the repo's own graph true: a package resolves to the source
beside it, an undeclared import fails at install time, and there is no second statement of the
version anywhere to drift from the first
([ADR-0004](0004-no-typescript-project-references.md) makes the same argument about
`references[]`). Declaring `workspace:^0.1.0` in nine manifests puts a hand-maintained range in
every one of them, and each is a chance to publish a `@hatua/react` whose stated floor is a
`@hatua/model` that never shipped. The nine packages are one library cut along build seams, not
nine libraries — versioning them apart would be describing a boundary that the imports do not
have.

## What one version does not promise

One version across nine packages says those nine were built from one commit. It says nothing about
the seven being stable to depend on, and it must not be read that way. The supported surface is
`@hatua/react` and `@hatua/sdk`; an export that only `@hatua/services` has is free to change on
any release, because the only caller that matters shipped in the same tag.

## Consequences

- **The tag is the only input to a release.** It names the version for all nine packages, the
  GitHub Release and the Go module mirror. Nothing in the repository records a version that a tag
  does not set.
- **A patch to one package is a release of all of them.** Eight packages get a version bump whose
  content is unchanged. That is the cost, it is paid every time, and it is smaller than a Host
  pinned to a fix it cannot install.
- **A partial publish is a broken release, not a reduced one.** Seven of nine on the registry
  leaves `@hatua/react` naming two exact versions that do not exist, so the release workflow runs
  the publishes in one job and refuses to cancel one in flight.
- **The Go module shares the version without sharing the mechanism.** It carries the tag's version
  because the tag is the decision, not because anything resolves it against the npm packages
  ([ADR-0029](0029-the-go-module-resolves-through-the-apex.md)).
- **Revisit when a package acquires a caller outside this repository.** Independent versioning
  starts being worth its ranges when something Hatua does not build depends on one of the seven —
  and that is a decision to make deliberately, because an import path is a promise from the moment
  the first Host writes it.
