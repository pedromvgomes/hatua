# conformance

Fixtures both the TypeScript and Go implementations must agree on.

This matters more than the codegen does. Generation guarantees the two languages
share a *shape*; nothing guarantees they share *behaviour*. The rules that decide
whether a workflow is valid — a required field left empty, a `ref` field with no
reference, a non-final condition branch with no `when`, a connection whose type
does not match its field — are cross-field and manifest-dependent. None is
expressible in JSON Schema. Each is implemented once per language, and this
corpus is the only thing keeping those implementations honest.

When the expression language lands, its semantics get pinned here too: an
evaluator that agrees on syntax but disagrees on, say, null coercion produces a
workflow that looks right in the builder and does the wrong thing in production.

## Layout

```
definition/valid/*.yaml     must parse and validate clean
definition/invalid/*.yaml   must fail; the expected diagnostic codes are in the
                            file's own `# expect:` header
execution/*.yaml            must parse
manifest/*.yaml             must parse
```

Invalid fixtures carry their expectation inline rather than in a sidecar file, so
a fixture and its expected result cannot drift apart.
