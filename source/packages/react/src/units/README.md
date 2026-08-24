# units

Presentational domain units — NodeCard, StepRow, BranchLabel, InsertPoint,
Connector, JoinMarker.

**Rule:** props in, events out. No reaching into `@hatua/services`. Enforced by
`noRestrictedImports` in the workspace `biome.json`.

Named `units` rather than `blocks` because a **Block** is a domain term — a named,
reusable sequence of Steps invoked as `use: block.<id>` — and one word for two
things in one repo is the *Flow tab* / `FlowMap` collision this repo has paid for
once already. Nothing in here is a Block, and a Block is not drawn by anything in
here.
