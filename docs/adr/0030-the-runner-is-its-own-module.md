# The runner is its own Go module

The runner executes a **Workflow Definition**: a **Host** registers a handler for each **Component**
it offers, and the runner walks the tree calling them. It lives in `source/runner` and is the Go
module `hatua.dev/runner`, beside the Go SDK (`hatua.dev/go`, in `source/sdk/go`) rather than inside
it. Loading, validation, **Reference** resolution and expression evaluation all come from the SDK,
so a workflow runs with the semantics the builder shows; the runner adds execution and nothing else.
It implements no **Host** **Function** and no **Component** itself — those are the Host's code.

## Why not a package inside the SDK module

Because the SDK is the part of Hatua that never executes. The glossary says Hatua provides libraries
and not a runtime, and [ADR-0013](0013-control-flow-nests.md) is what lets the SDK keep that
promise: control flow is structure to read, not a graph to run. A `runner` package in the SDK
module would make that sentence false for exactly the code a Host imports to read and validate a
definition. Go resolves a module as a unit, so a Host that only validates would take the execution
machinery and every dependency of it into its `go.sum`, and every change to the engine would be a
release of the contract reader.

The dependency runs one way. **The runner imports the SDK and the SDK never imports the runner**,
which is what a module boundary enforces and a package boundary only asks for. A Host that wants to
read definitions depends on the SDK alone; a Host that wants to run them adds the runner, and
nothing in the SDK changes to accommodate it.

## Why it versions on its own

The runner sits **outside** [ADR-0028](0028-one-tag-one-version.md). That rule exists because the
eight npm packages pin one another exactly, so a package published alone strands whoever depends
on it. The runner has no such edge: it requires the SDK by ordinary Go module resolution, which
takes a minimum version and lets a Host pick anything above it. Nothing is stranded by a runner
release that carries no SDK release, or the reverse.

Versioning them in lockstep is refused for the cost it would carry. An engine fix would force a new
SDK version whose content is unchanged, and an SDK fix would force an engine release nobody asked
for. The two change at different rates for different reasons — one follows the contract, the other
follows what Hosts need from execution — and a shared number would describe a boundary that does
not exist.

## The rule: the runner never depends on unreleased SDK code

The runner's `go.mod` requires a **released** `hatua.dev/go`, not the sources beside it. So work
that needs new SDK surface is split by what it changes:

1. An SDK change, merged on its own.
2. An SDK release, which is what makes that surface fetchable.
3. A runner change that raises the `hatua.dev/go` requirement and uses it.

A runner change that reaches for SDK code no tag carries cannot be built by anyone outside this
repository.

The workspace makes that mistake invisible. `go.work` resolves `hatua.dev/go` to the directory
beside the runner, so a build there succeeds against code that has never shipped. CI therefore
builds the runner twice: in the workspace, and with `GOWORK=off`, which resolves the requirement
the way a Host does and fails when the version it names does not exist.

## Consequences

- **The runner is a second module to release.** Its version is its own, and nothing in the SDK's
  release process waits for it.
- **An SDK change a runner needs costs a release first.** That is the price of the rule, and it is
  paid so the runner's published requirement is always true.
- **The SDK carries no execution.** A reader of the SDK can still say that Hatua never executes a
  workflow, and be right.
- **Host functions stay with the Host.** The runner supplies the walk and the handler registry; the
  code behind a **Component** or a **Function** is registered by the Host, as the SDK already
  assumes.
