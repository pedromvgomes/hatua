# Functions are namespaced and declared, and there is a third manifest kind

An **Expression** can call functions: `dt.now()`, `text.upper(s1.subject)`, and a **Host**'s own
`crm.owner_of(s2.account_id)`. Every function is addressed `namespace.name(…)`, every signature is
declared in YAML, and a **Host** declares its own in a **function manifest** — a third manifest
kind alongside `component` and `trigger`.

## Namespaces, and why nothing needs reserving

A flat namespace would mean Hatua's `upper` and a Host's `upper` collide, and the only fixes are
prefixing by convention (which nothing enforces) or a precedence rule (which makes a workflow behave
differently depending on registry order).

Namespacing also removes the need for reserved words. `(` is what distinguishes a call from a path,
so `crm` is a perfectly good step id right up until someone writes `crm(`. The only reserved words
in the language are `true`, `false` and `null`.

## Declared in YAML, implemented per language

Signatures live in `schemas/functions/*.yaml`; each language supplies only implementations and
verifies its registry against the declaration when it is built. A function implemented in one
language and not the other, or implemented with a different arity, fails at construction rather than
at a call site in production.

This is the same argument as ADR-0006, applied one level down: authoring the contract once, in a
neutral format both generators read, removes a whole class of divergence rather than testing for it.

**Registries are built by explicit construction**, never by module-level `register()` side effects.
Import-for-effect makes `sideEffects: false` a lie: a bundler can no longer drop a built-in nobody
calls, so every Host embedding the builder carries all thirty-four implementations — and nothing
warns you, because the import *looks* unused. In Go the reason is plainer: a registry assembled in
`init()` cannot be assembled twice, so a test cannot build one without the Host's functions in it.

**A namespace-and-name collision is a loud error at merge time.** Either silent winner is a workflow
that behaves differently depending on which registry was built first, and neither is discoverable
from the workflow.

## A third manifest kind

ADR-0007 recorded, as a consequence, that "there are only two manifest kinds, `component` and
`trigger`". **That consequence is superseded.** It was reasoning about *connections* — the point
being that there is no connector manifest, because connections are established outside Hatua and
arrive carrying their own type. It never considered functions, which are not connections and raise
none of the same questions: a function manifest holds no credentials, describes no flow Hatua cannot
run, and needs no server.

The rest of ADR-0007 stands unchanged.

**The declaration is a separate file rather than a `kind: function` branch inside
`component-manifest.schema.yaml`.** A conditional manifest shape — `if kind is function then …` —
would require the JSON-Schema-to-zod generator to grow `if`/`then` support, and ADR-0006 keeps that
generator deliberately narrow *because* a silent mistranslation there is the failure the whole
decision prevents. Two files cost a `$ref` and buy a generator that stays boring.

## What is not in v1

**No lambdas, therefore no `list.filter` and no `list.map`.** Closures mean scoping and capture
semantics implemented twice, and getting them subtly different is exactly the failure this design is
organised against. `[]` projection and `core.for_each` cover the common cases. Deferred, not
excluded — nothing in the grammar blocks adding them.

**No free-form date or number format strings.** A format string is a second language to keep two
implementations agreeing on. `dt` is RFC 3339 only.

## Consequences

- **Hatua never implements a Host's function.** It reads the signature so the builder can offer it,
  check its arity and argument types, and know what it returns; the Host's runner supplies the code.
- **Adding a core function means editing YAML and both implementations**, in one change, with a
  scenario. The registry check makes a half-done addition fail immediately rather than in one
  language's production.
- **`json.parse` returns `unknown`**, which is what makes the gradual type checking of ADR-0009 load
  bearing rather than theoretical: without it there would be no motivating case for the warning row,
  and the checker would only ever accept or refuse.
- **Argument checking happens once**, at the call site, from the declaration — not at the top of
  thirty-four implementations. A Host's function is checked by the same code for the same reason.
- **`text` is the universal sink for arguments too**, so `text.concat(s2.count, '!')` needs no
  converter while the implementation still only ever sees text.
