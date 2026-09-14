# @hatua/react

The Hatua workflow designer: React components, hooks and theming.

Hatua is an embeddable workflow builder. A Host drags Steps together, maps one
Step's typed outputs into the next, branches and loops — and reads and writes
the resulting Workflow Definition as plain YAML. Hatua renders the designer
and the run history a Host hands it; it never executes anything itself.

This package is the primary surface: the one a Host installs to render
Hatua.

## Install

```sh
npm install @hatua/react react react-dom
```

## Use

```tsx
import { Hatua } from '@hatua/react'

export function App() {
  return <Hatua />
}
```

`<Hatua>` mounts the provider and the whole screen. A Host that wants storage
or run history wired up passes `ports` and `workflowId`; without them the
designer says it has nothing to edit rather than inventing something.

## Stability

This surface is 0.x and still moving. While it stays 0.x, a breaking change
can land on a minor version bump, so semver alone does not protect a Host
that upgrades freely. Pin an exact version and read the release notes before
upgrading.

## The other `@hatua/*` packages

`@hatua/document`, `@hatua/expressions`, `@hatua/layout`, `@hatua/log`,
`@hatua/model`, `@hatua/schema` and `@hatua/services` are also on npm, but
only because this package's build treats them as externals rather than
bundling them. They are implementation details of `@hatua/react`, not a
supported API — nobody installs `@hatua/model` directly and expects a
contract.
