# Function signatures

The declaration is here; the implementations are in each language. Neither
language may add, rename or re-sign a function on its own: both registries are
checked against these files at load time, so a function that exists in one
runtime and not the other fails loudly instead of producing a workflow that
evaluates in the builder and not in the runner.

One file per namespace. A function is addressed `namespace.name(...)` — the
`(` is what distinguishes a call from a path, which is why namespaces need no
reserved words.

## Types

`text`, `number`, `boolean`, `datetime`, `list`, `object` and `item` are the
Component Manifest's output types. Two more exist only here:

- `unknown` — the value's type cannot be known statically. `json.parse` returns
  one. An `unknown` reaching a typed slot is a *warning* at design time and is
  checked at run time; see ADR-0009.
- `null` — the one absent value. It satisfies any declared type.

## Shape

```yaml
namespace: text
functions:
  - name: slice
    summary: One sentence, shown in the function picker.
    params:
      - { name: value, type: text }
      - { name: start, type: number }
      - { name: end, type: number, optional: true }
    returns: text
```

`variadic: true` on the last parameter means "one or more of this type".
Optional parameters must come last.
