# Syntax colour is ours, and the editor is a textarea

Two surfaces render source: **Text Mode**'s document, and the `resolved_input`,
`output` and trigger payload a run carries. Both were plain monospaced text, which
is unreadable at the length either of them reaches.

The obvious answer is a code-editor library — CodeMirror 6, or a wrapper over it.
We decided against one, and against a third-party tokeniser with it. Colour is
produced here, and **Text Mode** stays a `<textarea>` with a coloured layer
underneath.

## What a dependency would cost here specifically

`@hatua/react` has no third-party runtime dependencies at all: workspace packages,
and React as a peer. Every primitive is hand-built, which is
[ADR-0002](0002-hatua-ships-its-own-primitives.md)'s position — a library
embeddable in *any* Host cannot make that Host adopt a component library, and the
same argument reaches a dependency the Host cannot decline either. CodeMirror is
roughly 90–110KB gzipped for a minimal YAML setup, paid by every Host including
the ones whose users never open **Text Mode**, and it is the kind of dependency
that becomes impossible to remove: once it is there, Hosts depend on the
behaviour, not the colour.

## What it would not buy

**The payloads are the wrong shape for an editor entirely.** They are read-only,
and they arrive as JavaScript values rather than as text. There is nothing to
tokenise: `valueTokens` walks the value while serialising it, so a string is
coloured as a string because it *is* one. Serialising to text so that a parser can
work out what was already known is the tail wagging the dog, and a read-only
CodeMirror is still CodeMirror.

**No stock grammar knows a Template.** `"{{ var.digest_to }}"` is one flat string
to every YAML grammar there is, and the `{{ … }}` hole is the span a reader most
needs to pick out. Hatua has the parser for it already, so a Reference is coloured
by the same grammar that validates it — and
[ADR-0008](0008-one-peg-grammar-two-runtime-free-generators.md)'s rule holds:
`templateShape` derives the holes from the parse, so no hand-written scanner sits
in front of the parser and disagrees with it about `{{ '{{' }}`.

**The lexer was already in the tree.** `@hatua/document` depends on `yaml` because
that is the package that owns the YAML seam, and `yaml` exposes a `Lexer` that is
total over any string. So `lexYaml` lives there, beside `parseWorkflow`, and adds
nothing to a Host's install.

The lexer rather than the parser is the load-bearing half. `parseWorkflow` refuses
a source it cannot compose and is right to — but a reader typing spends most of
their keystrokes on text that does not parse, and colour that flickered off
between two valid states would be worse than no colour at all.

## What it costs us

A textarea with a painted layer underneath is not an editor, and this is the whole
of what it does not do: no folding, no bracket matching, no autocomplete, no
find-and-replace, no multiple cursors, no gutter. `Tab` inserts a tab only because
the browser does; nothing here understands indentation. A very large document
repaints the whole coloured layer on every keystroke, where an editor would
repaint a viewport.

Two layers holding one string is also a real hazard, and it is the reason the
tests assert **reassembly** rather than appearance: a highlighter that drops or
doubles a character does not merely mis-colour, it puts the caret between the
wrong glyphs. `lexYaml`, `yamlTokens` and `valueTokens` are each held to it.

Everything that decides where a character lands — the face, the size, the line
height, the padding, the wrapping — is therefore declared once and inherited by
both layers, rather than written twice and kept level by inspection.

## When to revisit

This is the decision to reopen if **Text Mode** is asked to fold regions, search,
complete a Reference as it is typed, or diff two versions. None of those is asked
for, and each is a thing a real editor does that a painted layer cannot be made to
do. The mirror is around a hundred and fifty lines and is thrown away whole, so
the cost of having taken this path first is small — which is most of why it is the
path taken first.

## Consequences

- **Six theme tokens, and they are permanent.** `--hatua-code-key`, `-string`,
  `-number`, `-comment`, `-reference` and `-selection` join the semantic aliases a
  Host inherits, defined in `base.css` in all three colour-mode blocks like every
  other colour. `-reference` is `var(--hatua-text-accent)`, so a Host re-theming
  gets a Reference in its own accent for nothing.
- **The selection is translucent, and that is structural rather than taste.** The
  band is drawn by the box on top, over the colour underneath, so an opaque one
  covers exactly what it is selecting — drag across a line and the line goes
  blank. The selected glyphs stay transparent for the mirror of that reason: a
  `::selection` setting only a background leaves the text colour to the browser,
  which paints its own contrasting one, and the box's characters then appear over
  the painted ones slightly off. Both halves are what "two layers holding one
  string" costs, and neither is a thing an editor library would have made us
  think about.
- **Punctuation and plain scalars are not new colours.** They read
  `--hatua-text-muted` and `--hatua-text-primary`. A highlighter that colours
  everything says nothing about anything.
- **`units/Code` takes tokens and decides nothing.** Props in, events out — the
  tier's rule. It carries no line numbers, no gutter and no scrolling of its own,
  because one of its two callers is putting it *under* a textarea where any chrome
  of its own would be chrome the caret does not know about.
- **`@hatua/react` now declares `@hatua/document`.** It was already in the
  runtime graph through `@hatua/services`, so nothing is added to a Host's
  install; the direct dependency is there because the package now imports it
  directly, and a package should declare what it imports.
