---
about: npm can only enrol a trusted publisher on a package that already exists, so the nine names were created by hand-published 0.0.0 placeholders before the release workflow could publish over OIDC
saw:
  - .github/workflows/release.yml
  - docs/release-notes/v0.1.0.md
---

`.github/workflows/release.yml` publishes with no npm secret: npm exchanges the job's OIDC token for
a short-lived credential. That works only because every one of the nine names already exists on the
registry.

npm — unlike PyPI, which supports pending publishers — requires a package to exist before a trusted
publisher can be configured on it, because the enrolment lives in the package's own npmjs.com
settings. A name that has never been published therefore cannot publish over OIDC, and its first
publish has to authenticate some other way.

Each of the nine was created by publishing a placeholder `0.0.0` by hand — a `package.json` and a
README, no code — after which a trusted publisher was enrolled per package against owner
`pedromvgomes`, repository `hatua`, workflow `release.yml`, no environment. Adding an `environment:`
to the publish job later would invalidate all nine enrolments, which name the environment as part of
the binding.

Two things surprised us and are worth knowing before adding a tenth package: npm sets the `latest`
dist-tag on a package's *first* publish whatever `--tag` says, so a placeholder is what `npm install`
resolves to until a real version supersedes it; and a version number is burned permanently once
used, even if unpublished.
