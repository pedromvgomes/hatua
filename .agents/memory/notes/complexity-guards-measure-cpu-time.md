---
name: complexity-guards-measure-cpu-time
kind: gotcha
description: Growth-ratio test guards must time with process.cpuUsage(), not performance.now(), or they flake under the full parallel turbo test run.
anchors:
  - path: source/packages/model/src/scope.test.ts
    blob: 2ebfc3762548
  - path: source/packages/layout/src/layout.test.ts
    blob: 641d795fa85d
  - path: source/turbo.json
    blob: ce5e3269fe4d
confidence: verified
---

Two tests guard an algorithm's growth *shape* by timing two input sizes and asserting the ratio:
`scopeFor` quadratic-not-cubic with a bound of 32 (`source/packages/model/src/scope.test.ts:202`),
`layout()` linear-not-quadratic with a bound of 10 (`source/packages/layout/src/layout.test.ts:1060`).
Both take the minimum of five runs of `process.cpuUsage()` user+system microseconds
(`scope.test.ts:182-185`, `layout.test.ts:1040-1043`), not wall-clock time.

Why: `pnpm test` is `turbo run test` (`source/package.json:12`), which fans out to one vitest
process per package, and nothing caps that — no `concurrency` in `source/turbo.json` and no
`maxWorkers`/`fileParallelism` in any `vite.config.ts`. Under that load, elapsed time measures
scheduling: the large pass is descheduled partway through on every run while the small one fits
between interruptions, so taking a minimum rescues only one side of the ratio. The reasoning is
spelled out in the doc comments at `scope.test.ts:161-176` and `layout.test.ts:1019-1035`, but
only a reader of those two files sees it — a new ratio guard in another package written with
`performance.now()` will pass alone and flake in the full run.

Carrying the pattern over needs two more things: divide by `Math.max(small, 1)` (one microsecond,
the clock's resolution — `scope.test.ts:202`), and a file-top
`biome-ignore-all lint/correctness/noProcessGlobal` (`scope.test.ts:1`, `layout.test.ts:1`),
because `source/biome.json:22` sets `correctness` to error, banning the `process` global.

Still on the wall clock: `source/packages/model/src/loops.test.ts:513-515` asserts an absolute
500 ms budget with `performance.now()`. It is a generous budget against exponential blow-up rather
than a ratio, but it is exposed to the same contention.
