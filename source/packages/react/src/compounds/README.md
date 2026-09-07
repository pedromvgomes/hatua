# compounds

Domain-aware inputs built from primitives — the Template input and the surfaces
it opens.

**Rule:** may import domain *types*, but not `@hatua/services`. Props in, events
out. Enforced by `noRestrictedImports` in the workspace `biome.json`.

`ReferenceTree` is where it earns its keep. A popover over a field and a column
standing open beside the step editor are different places asking the same
question, and a second implementation would be a second answer about what is
readable and what a row's rail means. What differs between the two is expressed
as props — the column marks the leaves already read and reports the one being
pointed at; the popover does neither — so `layouts/Data` supplies the stores and
this stays a component that reads none.

That rule is the load-bearing part here rather than a tidiness one. Scope, the
declared type and the Functions all arrive as props; nothing in this directory
reads a store or fetches anything. It is what lets the same input serve a
workflow variable's value, a Trigger's field and a Step's field without knowing
which of the three it is in — and what lets a story mount one with a scope
written by hand.

| File | What it is |
| --- | --- |
| `TemplateInput` | The widget. A transparent field over a mirror that paints the holes, plus signature help and the ⚡ button. |
| `CompletionList` | The caret-anchored list: 30px rows, the typed prefix accented, the type at the right, a docstring strip under it. |
| `ExpressionPicker` | The 392px browsable panel — **Reference** and **Function** tabs, and the inserter behind the second. |
| `ReferenceTree` | The scope as browsable rows, and the source `<select>` over them. Mounted twice: by the picker's **Reference** tab, and by the `Data` region beside the step editor. |
| `candidates.ts` | The scope and the declared Functions as rows. Pure, and the reason "two surfaces, one set of candidates" is a fact rather than an intention. |
| `insertion.ts` | Where the caret is, what an insertion there has to produce, and what a drag carries. |
| `templateSpans.ts` | Where each `{{ … }}` sits, derived from the parse. |

## Two questions about `{{`, and only one of them is the parser's

`templateSpans` refuses to look for delimiters in the text and works entirely
from what the parser returned; `insertion.caretContext` reads them directly. The
difference is what each answer is used for.

**Highlighting is about meaning.** A `{{ '{{' }}` painted as two holes would be
the highlighter disagreeing with the parser about what the text says, and
ADR-0008 puts segmentation inside the shared grammar precisely so no scanner
sits in front of the parser in either language.

**The caret is about position** — where a popup goes, and which characters an
accepted row replaces. Nothing it returns decides what anything means, every
value it produces is handed straight back to the parser a keystroke later, and
it has to answer while the text does *not* parse, which is the ordinary state of
a Template halfway through being typed.

The rule that has no exception is the one about **References**: a token is
composed from a `ScopeEntry` path and never pattern-matched out of text.
`@hatua/expressions` owns what a Reference is, and `REFERENCE_PATTERN` was
retired for being a second definition that eventually disagreed with the first.

## The inserter inserts and never round-trips

It composes call text and writes it; it never reconstructs itself from text
already there. A round-tripping editor needs AST→text, which the grammar does
not provide — Peggy gives text→AST — and hand-writing it is a second
implementation of the grammar that will disagree with the first (ADR-0008).
Reopening it starts fresh, and editing an existing call means editing text,
which the input is always typeable through.

## Reading declarations, never registries

`CORE_FUNCTIONS` and `CORE_NAMESPACES`, never `coreFunctions()`. The latter
builds the runtime registry and pulls all thirty-four implementations into a
Host's bundle; the declarations carry everything a list, a signature strip and
an inserter need, which is what `ParamSpec.description` and the namespace
`summary` exist for.
