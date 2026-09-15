---
about: the complexity guards in scope.test.ts and layout.test.ts measure process CPU time rather than elapsed time, because the full suite runs more vitest processes than the machine has cores
saw:
  - source/packages/model/src/scope.test.ts
  - source/packages/layout/src/layout.test.ts
  - turbo.json
---

Two tests assert an algorithm's *shape* by timing two input sizes and comparing the ratio:
`scope.test.ts` guards quadratic-against-cubic in `scopeFor` with a bound of 32, `layout.test.ts`
guards linear-against-quadratic in `layout()` with a bound of 10. Both take the minimum of five
runs and assert a ratio rather than a millisecond budget, because absolute timings vary by an order
of magnitude between machines.

Both measure `process.cpuUsage()` (user + system, microseconds), not `performance.now()`.

`pnpm test` runs `turbo run test`, which fans out to a vitest process per package — around ten of
them, each spawning worker threads — and neither `turbo.json` nor any package's `vite.config.ts`
sets a concurrency ceiling. Elapsed time then measures how often a process is handed a core. The
large measurement is long enough to be descheduled partway through on every run while the small one
fits between two interruptions, so taking a minimum rescues one side of the ratio and not the other.
Measured on `layout`: 5.79 idle and 5.89 under a full parallel run by CPU time, against 21.5 by the
wall clock with the bound at 10.

A third guard written with `performance.now()` will flake the same way. The unit change also moves
the divide-by floor to `Math.max(small, 1)` — one microsecond, the clock's resolution.

Both files carry a file-top `biome-ignore-all lint/correctness/noProcessGlobal`, because the repo's
biome config sets `correctness` to error, which bans both the `process` global and a `node:process`
import.
