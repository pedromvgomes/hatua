---
name: npm-trusted-publisher-needs-an-existing-name
kind: gotcha
description: A new publishable package cannot release over OIDC until its name exists on npm and a trusted publisher bound to environment npm-release is enrolled by hand.
anchors:
  - path: .github/workflows/release.yml
    blob: b858e92d1deb
confidence: suspect
---

`.github/workflows/release.yml` publishes with no npm secret: npm exchanges the job's OIDC token
for a short-lived credential (`release.yml:298-300`, `id-token: write` at `:160`). npm can only
enrol a trusted publisher on a name the registry already holds, so each of the nine names was
first created by a hand-published `0.0.0` placeholder (`release.yml:300-302`). A tenth package
added to the workspace is picked up by the publish step automatically (`release.yml:280-284`,
`:320`) and will fail there until that manual step is done for it.

The enrolment binds owner `pedromvgomes`, repository `hatua`, workflow `release.yml` and
environment `npm-release` (`release.yml:170-171`). The environment is part of the binding
(`release.yml:161-169`): renaming or removing it on the job invalidates all nine enrolments, and
they can only be fixed one package at a time on npmjs.com.

Unverified here — npm registry behaviour reported by the session that set this up, not checkable
from the repo: npm sets the `latest` dist-tag on a package's first publish regardless of `--tag`,
so the placeholder is what `npm install` resolves to until a real version supersedes it; and a
version number is burned permanently once used, even if unpublished (compare the E403-on-republish
note at `release.yml:286-287`).
