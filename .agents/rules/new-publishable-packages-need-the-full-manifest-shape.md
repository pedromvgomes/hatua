# A new publishable `@hatua/*` package carries `files`, `publishConfig.access` and `repository`

`pnpm --recursive publish` selects every workspace package whose manifest is not
`"private": true`, so a package becomes publishable the moment that flag is removed —
and each of the following is load-bearing, not boilerplate:

- `"files": ["dist"]` — without it, the published tarball carries the package's whole
  source tree instead of only its build output.
- `"publishConfig": { "access": "public" }` — a scoped package (`@hatua/*`) defaults to
  restricted; without this it fails to publish.
- `"repository"` naming this repository and the package's `directory` — `npm publish
  --provenance` fails with `ENEEDREPO` without it, and provenance is how trusted
  publishing in `.github/workflows/release.yml` proves where a package came from.

## Applies to

Any new `package.json` under `source/packages/*` or `source/sdk/*` that is meant to reach
npm.

## Example

```json
{
  "name": "@hatua/new-thing",
  "version": "0.1.0",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/pedromvgomes/hatua.git",
    "directory": "source/packages/new-thing"
  },
  "files": ["dist"],
  "publishConfig": { "access": "public" }
}
```

Also add a `LICENSE` file beside it — every published package ships its own — and, if the
package is a supported surface rather than a build-time external, a `README.md`.
