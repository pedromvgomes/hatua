---
name: provenance-needs-repository-field
kind: gotcha
description: The repository field in each published package.json is load-bearing — npm publish --provenance refuses a manifest whose repository.url does not match the building repo.
anchors:
  - path: source/packages/*/package.json
    matches:
      - path: source/packages/document/package.json
        blob: 6e407d5ab230
      - path: source/packages/expressions/package.json
        blob: 6244a817d559
      - path: source/packages/layout/package.json
        blob: 899d6431a03a
      - path: source/packages/log/package.json
        blob: 307e23eb5630
      - path: source/packages/model/package.json
        blob: 3c21c4665451
      - path: source/packages/react/package.json
        blob: c6b586276b20
      - path: source/packages/schema/package.json
        blob: 7b840d0ec904
      - path: source/packages/services/package.json
        blob: a485254ce736
  - path: source/sdk/js/package.json
    blob: 090046ee0a2a
  - path: .github/workflows/release.yml
    blob: b858e92d1deb
confidence: suspect
---

Every published manifest carries a `repository` block at lines 7-11 — e.g.
`source/packages/react/package.json:7-11`: `type: git`,
`url: git+https://github.com/pedromvgomes/hatua.git`, `directory: source/packages/react`. It reads
as npm-page metadata, but `.github/workflows/release.yml:350` publishes with `--provenance`, and
npm refuses that unless `repository.url` is present and matches the repository the workflow runs
in (npm's trusted-publishing docs: "your package's `repository.url` field in `package.json` must
exactly match your GitHub repository"; the candidate reported the error as `ENEEDREPO`).

Removing the field, or letting it drift from the remote, fails the release at the publish step,
after the build — and nothing in the test suite or CI covers it, because only the registry
enforces it. A new publishable package needs the block too. `directory` is the package's path
from the repo root; a wrong one just links the npm page to a path that does not exist.

Anchored by glob because the claim is about every published manifest: a new package under
`source/packages/` without the block is what breaks it.

Confidence is `suspect` because the npm-side rule is external and was not re-checked here; the
field's presence in all nine manifests was.
