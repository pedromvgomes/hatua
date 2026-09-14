# conformance

Fixtures both the TypeScript and Go implementations must agree on.

This matters more than the codegen does. Generation guarantees the two languages
share a *shape*; nothing guarantees they share *behaviour*. The rules that decide
whether a workflow is valid — a required field left empty, a `ref` field with no
reference, a non-final condition branch with no `when`, a connection whose type
does not match its field — are cross-field and manifest-dependent. None is
expressible in JSON Schema. Each is implemented once per language, and this
corpus is the only thing keeping those implementations honest.

The expression language's semantics are pinned here too, under `expression/`: an
evaluator that agrees on syntax but disagrees on, say, null coercion produces a
workflow that looks right in the builder and does the wrong thing in production.
Those scenarios have their own README, and their own harness — `make test` in
`tools/expression` runs both languages and compares how many scenarios each one
actually ran.

## Layout

```
definition/valid/*.yaml     must parse and validate clean
definition/invalid/*.yaml   must fail the SCHEMA; the expected result is in the
                            file's own `# expect:` header
definition/rules/*.yaml     documents that parse and are still wrong — a required
                            field empty, a fork with one branch, a block that
                            calls itself. Each scenario carries a definition and
                            the diagnostics both languages must report for it,
                            compared as a sorted set
execution/*.yaml            must parse
manifest/*.yaml             must parse; which schema a file is held to comes
                            from its own `kind`, since a Run Context is a
                            different file with a different shape. Also served
                            by the playground, which reads them at build time so
                            its Components tab shows the same catalogue both
                            SDKs are held to
expression/                 the {{ … }} language — see its own README
```

Invalid fixtures carry their expectation inline rather than in a sidecar file, so
a fixture and its expected result cannot drift apart.
