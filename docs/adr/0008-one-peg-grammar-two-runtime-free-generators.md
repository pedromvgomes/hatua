# One PEG grammar, two runtime-free generators

The `{{ … }}` language has to be parsed identically by `@hatua/expressions` and
`hatua.dev/go/expressions`. We hand-author one PEG grammar and generate both parsers from it —
`pigeon` for Go, `Peggy` for TypeScript — committing the generated output and checking it for drift
in CI.

This is hard to reverse. It commits us to a grammar file, two generated parsers in the tree, two
pinned tools, and an action subset the grammar must stay inside.

## Why not ANTLR

ANTLR is the obvious choice: one tool, one grammar, official targets for both languages, and the
parse trees are derived from a single artefact rather than from two generators that merely agree.
It was rejected on cost, measured rather than assumed: the JavaScript runtime is **~48 KB gzipped**,
and the Go target adds an `antlr4-go` module dependency.

That 48 KB is a *fixed* cost paid by every Host that embeds the builder, for a language whose whole
parser is smaller than its runtime. Measured against the alternative: the Peggy-generated parser is
**4.4 KB minified and gzipped**, and imports nothing. The Go parser is `net/http`-free stdlib only.
ANTLR also wants a JVM in the build, and nothing else in this repo does.

## Why not hand-written parsers

Two hand-written recursive-descent parsers would also be runtime-free and would remove the tooling
entirely. They were rejected because precedence and associativity would then be encoded twice, in
two languages, by hand — and a precedence bug is the divergence class that is *invisible to
evaluation tests*, since two parsers can build different trees that evaluate alike on every sample
until one workflow hits the disagreeing case.

## What the shared grammar actually guarantees, and what it does not

Less than ANTLR would. Two generators mean the parsers are no longer derived from one artefact at
the tool level: they are derived from one *input* by two independent programs. If pigeon and Peggy
ever disagree about what a construct means, one grammar will not save us.

So the guarantee is carried by three things together, and the grammar alone is the weakest:

1. **`conformance/expression/parse/`** — scenarios asserting the *tree shape*, as an S-expression,
   run against both languages. This is what would catch a genuine dialect disagreement.
2. **`make lint`** — the grammar must stay inside the subset both accept.
3. **Pinned tool versions.** A tool upgrade silently altering either parser is precisely the failure
   this decision exists to prevent, and it would not appear as a test failure. It would appear as a
   workflow behaving differently in a runner than in the builder.

## The shared subset, measured

The two dialects were probed against a realistic grammar before anything was built on the assumption
that one file could feed both. Four differences turned up, and all four are closed inside the
grammar rather than by a per-target rewrite pass:

| Difference | Resolution |
| --- | --- |
| `<-` is pigeon-only | `=` is accepted by both, so `=` is the spelling |
| `$` text capture is Peggy-only | a `str(...)` helper flattens matches instead, in both languages |
| a label named `c` shadows pigeon's action receiver | no label may be called `c` |
| reading the current offset (`c.pos.offset` vs `offset()`) | one rule, `At`, supplied per language |

`At` is the only rule not shared verbatim. It lives in a three-line epilogue rather than the
preamble because the first rule in a PEG file is the start rule in both tools.

Action bodies are the constraint most likely to erode, so they are the one the lint is strictest
about: every action must be exactly `return <helper>(…)`, which is simultaneously valid Go and valid
JavaScript given a per-language helper of the same name. All the awkwardness — pigeon returning
`[]byte` where Peggy returns a string, sequences arriving as nested arrays — is absorbed in
`nodes.ts` and `nodes.go`, which are hand-written and small.

## Generate, verify, promote — one task, never two

`make build` generates into a staging area, runs that language's suite **with the staged files
substituted in** (`go test -overlay` for Go, a vite alias for TypeScript), and promotes only what
passed.

Generating into the destination and testing afterwards has two failure modes we would rather not
have: the harness cannot run until the files are already in place, and a failed run leaves the
committed, working parser replaced by an untested one. Under this arrangement the committed parser
is, by construction, a parser that worked.

`make check-drift` is the same pipeline stopping before the promote and diffing instead, so CI
verifies the committed artefacts are both current *and* passing.

## Consequences

- **The grammar must stay inside the shared subset**, and `make lint` is what stops it drifting one
  convenient Go-ism at a time. Anything the subset cannot express is a design constraint on the
  language, not a licence to fork the grammar.
- **Generated output is committed.** Ordinary contributors and Go module consumers never run either
  tool; only someone changing the grammar does. This is also forced for Go: `go:embed` cannot reach
  outside its own module, so nothing outside `sdk/go` is embeddable and a symlink breaks inside
  module zips.
- **The generated parser lives in `package expressions` itself**, not a subpackage, because pigeon's
  actions call the helpers unqualified. Generated files are marked by a `.gen.go` suffix rather than
  by directory.
- **Scannerless PEG parses the whole Template**, not just the expression, so `{{` / `}}`
  segmentation is generated in both languages instead of being a hand-written scanner on each side —
  a divergence surface that would otherwise sit in front of the parser. The `{{ '{{' }}` escape
  needs no rule at all: it is a hole holding a text literal.
- **Precedence is structural.** With no left recursion it is an explicit rule cascade, visible in the
  file rather than emergent from a precedence-climbing algorithm — but associativity then lives in a
  hand-written fold, once per language, which is exactly why the parse scenarios exist.
- **Revisit if** the dialects diverge in a way the subset cannot absorb, or if a third target
  appears. ANTLR becomes the better trade the moment "two generators" becomes three.
