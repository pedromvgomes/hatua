---
about: npm refuses `publish --provenance` with ENEEDREPO unless the manifest carries a repository whose URL matches the building repository, so the repository field in the nine manifests is load-bearing for the release
saw:
  - source/packages/*/package.json
  - source/sdk/js/package.json
  - .github/workflows/release.yml
---

Each of the nine published manifests carries:

```json
"repository": { "type": "git", "url": "git+https://github.com/pedromvgomes/hatua.git", "directory": "source/packages/<name>" }
```

It reads as metadata for the npm package page, and it is also what makes the release work.
`.github/workflows/release.yml` publishes with `--provenance`, and npm rejects that with `ENEEDREPO`
unless `repository.url` is present and matches the repository the build runs in. npm's own
trusted-publishing documentation states the requirement: "your package's `repository.url` field in
`package.json` must exactly match your GitHub repository."

Removing the field, or letting it drift from the remote, fails the release at the publish step —
after the build has run and with nothing else left to do but succeed. Nothing in the test suite
covers it, because it is the registry that enforces it.

`directory` is the package's path from the repository root, which is what npm links through to from
the package page; a wrong value resolves to a path that does not exist.
