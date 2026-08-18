# expression

The shared scenarios for the `{{ … }}` language. Both `@hatua/expressions` and
`hatua.dev/go/expressions` load *these files* — not copies, not translations —
and the single most important signal in the whole build is that the same file
passes in both.

## Why parse and eval are separate

Precedence and associativity bugs are *parse* bugs, and they are invisible to
evaluation scenarios whenever two parsers build different trees that happen to
evaluate alike on the sample data. That is the most dangerous divergence there
is, because it passes everything until one workflow hits the disagreeing case.

They matter more here than they would have under a single-artefact tool: two
generators mean the parsers are no longer derived from one artefact at the tool
level, so the parse scenarios plus the grammar lint are what carry the guarantee
the shared grammar cannot.

## Layout

```
parse/*.yaml         source -> the AST, as an S-expression
eval/*.yaml          context + slot -> a value, or an error code
diagnostics/*.yaml   source + scope + declared type -> codes AND severities
```

## The S-expression

Asserting on a nested YAML literal of the node graph would be unreadable enough
that nobody would notice it asserting the wrong thing. `(- (- 1 2) 3)` says
"folds left" at a glance. Both languages print it; that printer is itself part
of the contract these scenarios check.

| Node | Printed |
| --- | --- |
| Template | `(template (text "hi") (hole …))` |
| Name | `s2` |
| Member | `(. <object> count)` |
| Index | `([] <object> <index>)` |
| Project `a[]` | `(project <object>)` |
| Call | `(call <callee> <arg>…)` |
| Unary | `(! <x>)`, `(neg <x>)` |
| Binary | `(<op> <left> <right>)` |
| Conditional | `(?: <cond> <then> <otherwise>)` |
| Literals | `1`, `3.5`, `"hi"`, `true`, `null` |

With `offsets: true` every node gains `@<offset>`, which is how the offsets a
diagnostic points at are pinned.

## Writing one

Scenarios are written *alongside* the behaviour they describe, never batched at
the end. A behaviour tested in one language is a behaviour that will diverge.
