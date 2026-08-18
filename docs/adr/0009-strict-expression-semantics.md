# Strict expression semantics: one absent value, no coercion, types declared not inferred

Every mainstream template language coerces freely. Jinja, Liquid, Handlebars, Workato and n8n all
let `"24" > 0` mean something, all have several ways of being absent, and all treat a non-empty
string as true. Hatua's expression language does none of it, so this needs justifying.

The justification is the failure mode Hatua is built around. A **Workflow Definition** is authored
in a builder and executed by a **Host**'s runner, in a different language. A coercion rule is a
place the two implementations can quietly disagree, and the result is not an error anyone sees — it
is a workflow that looks correct in the editor and does the wrong thing in production, silently, at
3am.

## What was measured

Probing Go against Node surfaced four disagreements between the two languages' *defaults*, before
any coercion rule was even in scope:

| Operation | JavaScript | Go | Rule adopted |
| --- | --- | --- | --- |
| `round(-0.5)` | `-0` | `-1` | half away from zero; hand-implemented in TypeScript |
| `upper("ß")` | `"SS"` | `"ß"` | full Unicode mapping; Go grows `golang.org/x/text` |
| `lower("İ")` | 2 code points | 1 | as above, and language-neutral, never locale-sensitive |
| `String(1e-6)` | `"0.000001"` | `"1e-06"` | ECMAScript `Number::toString`, ported into Go |
| `7 / 2` | `3.5` | `3` | one numeric type, `float64`; Go never reaches for `int` |

None of these is a coercion rule. They are the *floor* — the divergences present even when both
sides are trying to do the same thing. Adding an implicit-conversion table on top of that floor is
adding failure modes to a problem that already has some.

## The decisions

**Exactly one absent value, `null`.** A missing key yields it; reading a property of it yields it
again. `evaluate()` never returns `undefined`. Two absent values means two truth tables, twice, in
two languages.

**Operators never coerce.** `1 == '1'` is false. `'a' + 'b'` is an error — `+` is numeric only and
`text.concat` is the concatenation primitive. A boolean context requires a boolean; nothing is
truthy, so a non-zero number in an `if` is a mistake rather than a shortcut.

**Ordered comparison with null, or across types, is an error.** `null < 1` is neither true nor
false, and answering `false` means a branch acts on an answer nobody chose. `==` and `!=` are the
exception: they are *total*, defined for every pair, and answer `false` across types rather than
raising — because "are these the same value" always has an answer.

**Division by zero is an error**, which is what keeps `NaN` and `Infinity` out of the value space
entirely rather than requiring every downstream operator to have an opinion about them.

**`??` is the only fallback.** One mechanism, and it falls back on `null` alone — never on zero,
never on empty text.

**Interpolation stays soft.** A null inside mixed text renders as empty. This is the one deliberate
exception, because that is what mixed text *means*, and it has its own scenario file so the
exception stays visible rather than becoming folklore. It does not extend to non-scalars: a list
interpolated into a sentence is far more likely to be a mistake than an intention, and
`json.stringify()` says so explicitly when it is not.

**`onMissing: 'error' | 'null'`, default `'error'`.** It governs path *resolution* only, never
operator semantics — which is what keeps the truth tables single-valued. Under either setting,
`null` still cannot be ordered.

## Types are declared by the manifest, never inferred from the expression

The expected type is always known *before* the expression is looked at: it comes from
`FieldSpec.kind` for a `with:` value, and it is `boolean` for a **Branch**'s `when`. Nothing infers
a field's type from what someone wrote into it.

What varies is whether the expression's *own* type can be determined statically, and that gives
three outcomes:

| Expression type | Design time | Run time |
| --- | --- | --- |
| known, matches | accepted | value checked, passes |
| known, conflicts | **error — publish blocked** | never reached |
| **unknown** | **accepted with a warning** | `EVAL_TYPE_MISMATCH` if the value does not match |

The middle row is what makes the checker usable rather than something people route around.
`json.parse(s2.output).count` has no static type: refusing it would make the function unusable, and
accepting it silently would hide a real risk. The same treatment covers `t: item`, opaque `object`
members, and a conditional whose arms disagree.

The legacy `when: "{{s2.count}} > 0"` is that middle row inverted — statically `text` against a
declared `boolean`, a known conflict, publish refused. It never reaches a runner to be mistaken for
truthy.

**Coercion at the slot boundary is narrow and declared**, which is what gives "must match" a precise
meaning: any scalar into `text`, because a text field is the universal sink and that is exactly what
interpolation already does; `null` into anything, because whether absence is *acceptable* is `req:`'s
business and not the evaluator's; `text` into `number` never — that is what `num.parse()` is for;
and everything else exactly.

## Consequences

- **Existing workflows written in the loose style break loudly**, at publish, with an offset and a
  code. That is the intended trade: an error a user fixes in the builder, instead of a value a
  runner misreads.
- **Diagnostics never block editing.** Errors block **Publish**; warnings inform and block nothing.
  A half-written expression is an ordinary intermediate state.
- **Severity is part of the shared contract**, declared in `schemas/diagnostics.yaml` rather than
  chosen per language. A code that errors in TypeScript and warns in Go would let a workflow publish
  from one builder and not another.
- **The type checker ships in Go too**, not only in the builder. A checker existing in one language
  is precisely the divergence the corpus exists to prevent.
- **`dt.now()` reads a caller-supplied clock**, never the system clock — otherwise it is unfixturable
  and two steps in one run disagree about when "now" was.
- **The SDK reports; the Host disposes.** A failure yields a typed error with a stable code, the slot
  it happened in, and an offset. Hatua never decides whether a step fails or a run aborts.
- **Revisit the strictness only with evidence from real workflows**, and never one operator at a
  time: the value of "operators never coerce" is that it is derivable, and a table of exceptions is
  worth less than the rule.
