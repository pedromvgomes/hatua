---
name: region-walks-are-two-and-must-agree
kind: invariant
description: A container's child regions are enumerated twice — regionsOf on the typed tree, stepEntriesIn on the raw AST — and nothing makes them agree.
anchors:
  - path: source/packages/model/src/tree.ts
    blob: c3bb059587de
  - path: source/packages/services/src/ast.ts
    blob: 951b88d9bce8
  - path: source/packages/services/src/blocks.ts
    blob: c6f977e55e73
  - path: source/packages/model/src/segment.ts
    blob: fc8065f9e248
  - path: source/packages/layout/src/layout.ts
    blob: eab9a4ee0633
confidence: verified
---

There are exactly two independent enumerations of what a container Step nests:

- `regionsOf` (`source/packages/model/src/tree.ts:200`), over the **typed** tree. `RegionKind`
  is `'branch' | 'body' | 'handler'` (`tree.ts:140`).
- `stepEntriesIn` (`source/packages/services/src/ast.ts:420`), over the **raw YAML AST**.
  `@hatua/services` cannot use `regionsOf` because an `EditCommand` runs against a document
  that does not project to the typed tree (ADR-0019/ADR-0001).

Everything else is built on one of those two and follows automatically — `walkSteps`,
`isContainer`, `summaryOf` (`tree.ts:268`, `tree.ts:321`), `stepLists` in `validity.ts`,
`collectUpstream` in `scope.ts`, `segmentReturns` (`segment.ts:163`), and
`@hatua/layout`, which **imports** `regionsOf` from `@hatua/model` (`layout.ts:9`, used at
`layout.ts:606`, `:711`, `:828`) rather than walking regions itself. So `layout` is not a
third thing to keep in step.

The two that do drift are the pair: `extractBlock` (`services/blocks.ts:441`) and
`holdsReturn` (`services/blocks.ts:537`) walk the AST, and `holdsReturn` is the explicit twin
of `segmentReturns`. Both sites say the coupling in a comment (`segment.ts:154-161`,
`blocks.ts:533`) — but `tree.ts`, where someone adding a `RegionKind` or a new container verb
starts, says nothing about `services`. No shared import forces a compile error, so a region
kind added to one walk and not the other yields a canvas action offered on a selection the
command refuses, or a Segment extracted wrongly — never a build failure.

Adding a container verb or a `RegionKind` means grepping `regionsOf`, `stepEntriesIn`,
`RegionKind`, `TRY_VERB`, `REPEAT_VERB` across `model`, `services` and `react` (`TRY_VERB`
also reaches `react/src/layouts/FlowMap.tsx`).
