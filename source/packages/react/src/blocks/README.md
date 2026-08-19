# blocks

Presentational domain units — NodeCard, StepRow, BranchLabel, InsertPoint,
Connector, JoinMarker.

**Rule:** props in, events out. No reaching into `@hatua/services`. Enforced by
`noRestrictedImports` in the workspace `biome.json`.
