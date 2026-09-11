---
name: read-only-comes-only-from-usereadonly
kind: invariant
description: Every editing surface in layouts/ derives read-only from useReadOnly(), never from workflow.claimed, or a Preview renders as editable.
anchors:
  - path: source/packages/react/src/layouts/*.tsx
    matches:
      - path: source/packages/react/src/layouts/Components.stories.tsx
        blob: a11a58c61d35
      - path: source/packages/react/src/layouts/Components.test.tsx
        blob: bb1dff1910f3
      - path: source/packages/react/src/layouts/Components.tsx
        blob: bb40becd832d
      - path: source/packages/react/src/layouts/Data.stories.tsx
        blob: b0d4b41b493e
      - path: source/packages/react/src/layouts/Data.test.tsx
        blob: 63780003d060
      - path: source/packages/react/src/layouts/Data.tsx
        blob: 02b592f7d42d
      - path: source/packages/react/src/layouts/Fields.tsx
        blob: e925ff6a5fc3
      - path: source/packages/react/src/layouts/FlowMap.stories.tsx
        blob: ea4670897f43
      - path: source/packages/react/src/layouts/FlowMap.test.tsx
        blob: 9890448edbda
      - path: source/packages/react/src/layouts/FlowMap.tsx
        blob: 096ca8aca96e
      - path: source/packages/react/src/layouts/Inspector.stories.tsx
        blob: fdc104c5e12d
      - path: source/packages/react/src/layouts/Inspector.test.tsx
        blob: 5579d1f03fd2
      - path: source/packages/react/src/layouts/Inspector.tsx
        blob: e9b0f4af854f
      - path: source/packages/react/src/layouts/Placeholder.tsx
        blob: c5c6d487387e
      - path: source/packages/react/src/layouts/RunList.stories.tsx
        blob: 17f4f4a9282e
      - path: source/packages/react/src/layouts/RunList.tsx
        blob: 28d60e618673
      - path: source/packages/react/src/layouts/RunStep.stories.tsx
        blob: d85f5e93294d
      - path: source/packages/react/src/layouts/RunStep.tsx
        blob: 55cdc4f95a34
      - path: source/packages/react/src/layouts/StepList.stories.tsx
        blob: 749e8372e1b5
      - path: source/packages/react/src/layouts/StepList.test.tsx
        blob: 525c0dcbb0e8
      - path: source/packages/react/src/layouts/StepList.tsx
        blob: 7dfe557f6a5e
      - path: source/packages/react/src/layouts/TabbedPanel.tsx
        blob: f9549fd9538a
      - path: source/packages/react/src/layouts/TextMode.stories.tsx
        blob: cfeac14f2e83
      - path: source/packages/react/src/layouts/TextMode.test.tsx
        blob: 5b73ff38fae0
      - path: source/packages/react/src/layouts/TextMode.tsx
        blob: 1b9345b79bb9
      - path: source/packages/react/src/layouts/TopBar.stories.tsx
        blob: fa9941860079
      - path: source/packages/react/src/layouts/TopBar.test.tsx
        blob: cd11e0afe9fe
      - path: source/packages/react/src/layouts/TopBar.tsx
        blob: 006f720af062
      - path: source/packages/react/src/layouts/Workflow.stories.tsx
        blob: 445732c0e911
      - path: source/packages/react/src/layouts/Workflow.test.tsx
        blob: f8543bd06306
      - path: source/packages/react/src/layouts/Workflow.tsx
        blob: d6d8544fb42a
      - path: source/packages/react/src/layouts/regions.test.tsx
        blob: 127db73f617b
      - path: source/packages/react/src/layouts/runs.test.tsx
        blob: 6d46e8d7acef
  - path: source/packages/react/src/theme/readOnly.ts
    blob: 759fb474018e
confidence: verified
---

`useReadOnly()` (`source/packages/react/src/theme/readOnly.ts:33`) answers
`!claimed || previewing !== null` (`readOnly.ts:47-48`). The second disjunct is the one a
surface cannot rediscover for itself: during a **Preview** (ADR-0024/0025 — a Published
Version, or a run's referenced version) the claim is still held, so `workflow.claimed` is
`true` while the content on screen must not be edited.

Every editing surface under `layouts/` uses the hook: `Workflow.tsx` (`:523`, `:660`, `:729`,
`:848`, `:928`, `:1091`, `:1174`, `:1271`), `StepList.tsx` (`:193`, `:466`, `:732`),
`FlowMap.tsx:1114`, `Components.tsx:153`, `Inspector.tsx:181`, `TextMode.tsx:86`.
`TextMode.tsx:46` names deriving it locally as "the mistake the step editor made once
(ADR-0024)".

The one place that reads `workflow.claimed` directly is `TopBar.tsx` (`:358`, `:801`, `:900`),
which is chrome reporting claim/save state rather than an editing surface — not a violation.

A new region that reads `claimed` off the snapshot looks editable during a Preview, takes
keystrokes and drops every one of them: the store's `apply()` still refuses the commands, but
per ADR-0024 that refusal is "the half of this the store cannot fix on its own". This gate is
owned by the render layer; the store's refusals are a necessary-but-not-sufficient backstop.
Anchored by glob because the claim is about *every* surface in the directory — a new file
reading `claimed` is what falsifies it.
