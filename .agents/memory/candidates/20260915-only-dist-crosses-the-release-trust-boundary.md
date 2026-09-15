---
about: release.yml splits build from publish so dependency lifecycle scripts never run beside the publish credentials, and the artefact that crosses is constrained to dist/ because a manifest crossing it would be the manifest that gets published
saw:
  - .github/workflows/release.yml
  - .github/workflows/pages.yml
---

`.github/workflows/release.yml` has two jobs, and the seam between them is a safety property.

`build` holds no credentials — `contents: read`, `persist-credentials: false` on checkout — and is
where `pnpm install` runs third-party lifecycle scripts and the monorepo is built. `publish` holds
`id-token: write` for the OIDC exchange and the mirror App key, installs with `--ignore-scripts`,
and publishes with `--ignore-scripts`.

The split alone is not enough. The artefact is downloaded into a directory of its own rather than
over the checkout, the set of `dist/` directories that may be taken from it is read from the publish
job's own checkout, and anything the archive carries outside those paths fails the run. Unpacked
over the checkout instead, a `package.json` planted by a lifecycle script in `build` would become
the manifest `publish` publishes, and any `prepublishOnly` it names would run with the publish
credentials in scope — around the split rather than through it. The check enumerates with
`find . ! -type d`, so a symlink planted outside a `dist/` is caught rather than followed.

`.github/workflows/pages.yml` splits build from deploy for the same reason and is the model this
follows.
