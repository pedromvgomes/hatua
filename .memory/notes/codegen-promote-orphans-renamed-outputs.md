---
name: codegen-promote-orphans-renamed-outputs
kind: gotcha
description: Renaming a file in the expression codegen's TARGETS.files leaves the old generated file committed forever, and check-drift cannot see it.
anchors:
  - path: source/tools/expression/src/build.js
    blob: 731726c5d751
confidence: verified
---

`promote(target)` (`source/tools/expression/src/build.js:163`) copies only the names listed in
`target.files` from staging over the committed output directory; it never deletes anything in
the destination. That is deliberate — the Go destination is `package expressions`, shared with
hand-written source, so a "delete what wasn't generated" pass would delete runtime code.

The consequence nothing states: the same no-delete behaviour applies when a maintainer
*renames* an output inside `TARGETS.files` itself (`build.js:42`, lists at `:49` for Go and
`:57` for TypeScript). Say `parser.gen.go` becomes `parser2.gen.go` — the old file is never
regenerated and never removed, and `drift()` (`build.js:170`) only compares files still listed
in `target.files`, so the orphan is invisible to `--check-drift`. It keeps compiling and
shipping beside the real one indefinitely.

No lint or CI step catches this. Only deleting it by hand at rename time, or noticing it in
`git status`, surfaces it. Supports the generate-verify-promote pipeline of ADR-0008.
