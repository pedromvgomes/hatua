---
about: "The SDK validator raises COMPONENT_UNKNOWN for core verbs with no manifest, never validates variable values, and SlotsFor returns flat per-entry slots for map fields, so the runner supplies manifests for core verbs, resolves variables itself and rebuilds the keyed map"
saw:
  - source/sdk/go/validity.go
  - source/sdk/go/slots.go
  - source/runner/engine.go
  - source/runner/scope.go
---
- `ValidateDefinition` runs `UnknownComponents`, which reports COMPONENT_UNKNOWN for any `use` with no
  manifest, `core.end` and trigger verbs included (validity.go, `UnknownComponents`). The SDK ships no
  core manifests, so `runner.NewEngine` needs them in the manifest set a Host passes; the engine
  tests declare their own inline (engine_test.go).
- `ExpressionRules` checks Steps only (validity.go), so a variable's `value` template is never
  validated. `hatua.VariableSlot` (slots.go) is the typed Slot for it, and `Engine.Run` resolves
  variables through it in declaration order before any Step (engine.go, `seedValue`). A literal that
  does not match its `t` is therefore refused at run time, not at validation.
- `hatua.SlotsFor` returns one flat Slot per map entry, named `<field>.<key>`, and never the keyed
  object a `kind: map` field promises. `Scope.ResolveStep` rebuilds the object itself (scope.go). It
  also resolves a template in a `kind: text` field as text, which `expressions.Resolve` coerces
  only when the expected type is text; resolving with `TypeUnknown` hands a handler a float64 where
  a typed Node expects a string.
