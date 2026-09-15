# @hatua/sdk

The Hatua SDK for Node backends and workflow runners: the contract plus the
shared expression evaluator.

A Host that runs Workflow Definitions written in `@hatua/react` needs to
parse and validate the same YAML, resolve the same `{{ … }}` Expressions
against a Run Context, and load Manifests the same way the designer does. This
package is that half of the contract, published so a runner never has to
reimplement the expression language against its own reading of the format —
a runner that evaluates an Expression differently from the builder produces a
workflow that looks correct in the editor and does the wrong thing in
production.

`@hatua/sdk` has no UI and no dependency on React. `@hatua/react` is the
designer a Host embeds in a browser; this package is what runs on the backend
that stores and executes what the designer produces.

## Install

```sh
npm install @hatua/sdk
```

## The other `@hatua/*` packages

`@hatua/document`, `@hatua/expressions`, `@hatua/layout`, `@hatua/log`,
`@hatua/model`, `@hatua/schema` and `@hatua/services` are also on npm, but
only because `@hatua/react`'s build treats them as externals rather than
bundling them. They are implementation details, not a supported API —
nobody installs `@hatua/model` directly and expects a contract.
