# Hatua

An embeddable workflow designer. Read `CONTEXT.md` for the domain language,
`docs/adr/` for the decisions that constrain the code, and `docs/handoff.md` for
the design of record — what each region is, and why it is that shape.

## Go modules

`source/sdk/go` (`hatua.dev/go`) reads and validates Workflow Definitions; `source/runner`
(`hatua.dev/runner`) executes them and imports the SDK, never the reverse
(`docs/adr/0030-the-runner-is-its-own-module.md`). The runner's `go.mod` requires a *released*
`hatua.dev/go`, while the root `go.work` joins both modules for local builds. Test the runner both
ways — inside the workspace, and with `GOWORK=off` to resolve the SDK as a user's `go get` does — as
CI does.
