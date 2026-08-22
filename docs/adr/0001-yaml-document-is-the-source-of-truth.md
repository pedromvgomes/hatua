# The YAML document is the single source of truth

Hatua lets a user edit one **Workflow Definition** two ways — graphically on the flow map, and as
raw YAML text in the UI — and the **Host**, not Hatua, owns the file. We hold the parsed YAML
document (AST) as the one authoritative state and derive the graph from it on every render; canvas
edits are surgical mutations of that document, taking the same path a text edit takes.

The alternative — a typed graph object as the source of truth, with the AST retained only to reapply
formatting on save — makes graph operations more natural but requires a sync layer between two
representations, and that layer is where divergence bugs live. Because the file is hand-editable and
lives in the Host's repository with the user's comments in it, "the canvas and the text disagree" is
a defect we would rather make structurally impossible than test for.

## Consequences

- Node positions are **never stored**. The layout is computed from the tree on every render, which is
  what makes it impossible for a hand-edited file to disagree with the map. Free node positioning is
  therefore not available.
  *(Arbitrary cross-links between steps are refused too, but not by this decision: a file of `Next:`
  transitions lays out from its graph with no coordinates in it, so a graph does not force stored
  positions. Cross-links break **exact static scope**, and
  [ADR-0013](0013-control-flow-nests.md) carries that argument and the decision resting on it.)*
- Comments, key order and quoting style survive a round trip, because we never re-serialise the whole
  document from typed objects.
- The model stays a **tree**, matching the YAML's own nesting (`branches:`, `steps:`).
- Canvas interaction requires fast incremental edits against the document rather than cheap mutation
  of a graph object.
