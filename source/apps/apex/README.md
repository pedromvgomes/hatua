# @hatua/apex

The Cloudflare Worker behind `hatua.dev`. It serves the `go-import` tag that makes
`go get hatua.dev/go` resolve, and redirects everything else to the marketing site.

Not published. It is deployed, and `private: true` keeps it out of a release.

## Why the apex and not a subdomain

The import path is `hatua.dev/go`, so Go fetches exactly `https://hatua.dev/go?go-get=1`.
No subdomain can answer for it, and the path cannot be moved once a `go.mod` anywhere
depends on it. That is why the apex belongs to this Worker and the Storybook lives at
`storybook.hatua.dev` instead.

## What lives outside this repository

Three things the Worker depends on and no diff can show:

- **The apex DNS record is proxied.** A "DNS only" record never reaches Cloudflare, so
  the route never fires. The record is an `AAAA` to `100::` — a discard address that
  exists only to give the route something to attach to.
- **The route** `hatua.dev/*`, declared in `wrangler.jsonc` and applied on deploy.
- **`CLOUDFLARE_API_TOKEN`**, needing account `Workers Scripts: Edit` *and* zone
  `Workers Routes: Edit`. With only the first, the upload succeeds and the Worker is
  never invoked.

`verify-go-import.sh` is the guard: it fetches the deployed tag and compares it with the
module path in `source/sdk/go/go.mod`. The `apex` workflow runs it after every deploy and
once a day.

## Locally

```sh
pnpm --filter @hatua/apex test
pnpm --filter @hatua/apex exec wrangler dev
```

`wrangler dev` serves on localhost; paths behave as they do in production, so
`/go?go-get=1` returns the tag and anything else returns a 302.
