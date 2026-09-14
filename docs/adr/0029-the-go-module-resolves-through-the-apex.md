# The Go module resolves through the apex

The Go SDK is imported as `hatua.dev/go`. That import path is served by a Cloudflare Worker on the
apex domain, answering `go-get=1` with the meta tag that points at a generated mirror repository
whose root *is* the module. `source/apps/apex/README.md` documents the mechanics — the Worker, the
DNS record, the route, the token and the guard that checks the deployed tag — and this ADR does not
repeat them. What follows is why the apex, and why a mirror at all.

## A vanity path is not branding

`hatua.dev/go` costs a Worker, a mirror and a daily check, where `github.com/pedromvgomes/hatua/go`
costs nothing. The reason to pay is that an import path in Go is not a download URL, it is the
module's identity: it is written into every `go.mod` that depends on it, and into the checksum
database. A path tied to a repository owner's account is a rename, an org move or a transfer away
from being unfixable for every Host at once. The apex is the one name that does not depend on where
the code happens to be hosted, and the whole point of buying it is that the code can move
underneath it.

That is also why the mirror is acceptable. Go locates a module by subtracting the import path from
the repository root, so `hatua.dev/go` has to be fetched from a repository whose root is the
module — which `source/sdk/go/` in a monorepo can never be. The SDK is developed here, beside the
schemas, so a contract change and its SDK update land in one commit
([ADR-0006](0006-schemas-are-the-source-of-truth.md)); the mirror is a build artefact of that, cut
at release time and read-only to everyone. Splitting the SDK into its own repository to avoid the
mirror would buy nothing and lose the one-commit property.

## Why not a subdomain

There is no version of this that runs on `src.hatua.dev` or anywhere else. Go fetches the import
path itself — `hatua.dev/go?go-get=1` — so the path fixes the host, and the host is the apex by
construction. A subdomain could only serve a module named after that subdomain, which is a
different import path and therefore a different module.

The path's permanence is what makes this worth an ADR rather than a shrug. An import path cannot be
changed once anything depends on it: the old path stays fetchable forever or every dependent build
breaks, and the module cache and checksum database hold it besides. So this is decided before the
first `go get`, not after.

## Why not GitHub Pages

Serving the `go-import` tag from this repository's Pages site would need no Worker and no DNS
record. It is refused because **a repository gets one Pages custom domain**, and this repository's
is spent on `storybook.hatua.dev` — the Storybook is the review surface for the primitives
([ADR-0002](0002-hatua-ships-its-own-primitives.md)), and it is only useful as a link. Pointing
Pages at the apex instead would put the Storybook on the bare domain and leave the SDK's path with
nowhere to be served from, which inverts the priority: one of these two is permanent and the other
is a bookmark.

## Consequences

- **The apex belongs to the Worker, and everything else on it is a redirect.** Any future surface
  wanting `hatua.dev/<something>` goes through the Worker rather than around it, because the route
  is `hatua.dev/*` and `/go` must keep answering.
- **The domain is load-bearing infrastructure.** A lapsed registration or an unproxied DNS record
  does not degrade a website, it breaks `go get` for every Host — which is why the deployed tag is
  checked after each deploy and once a day rather than trusted.
- **The mirror is written to only by a release.** Issues and pull requests belong on this
  repository; a commit pushed to the mirror is lost at the next release, and `doc.go` says so to
  whoever reads the package there.
- **The Go module releases with the npm packages.** One tag names its version too
  ([ADR-0028](0028-one-tag-one-version.md)), and the mirror is pushed only once npm has accepted
  every package — a module tagged for a version the JavaScript side never got is a version nobody
  can use.
