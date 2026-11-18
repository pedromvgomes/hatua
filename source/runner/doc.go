// Package runner executes a Hatua Workflow Definition.
//
// A Host registers a handler for each Component it offers, and the runner walks
// a Workflow Definition Step by Step, calling the handler registered for each
// Step's Component. Loading, validation, Reference resolution and expression
// evaluation all come from the Go SDK (hatua.dev/go), so a Workflow runs with
// exactly the semantics the builder shows: the runner adds execution, not a
// second reading of the contract.
//
// The dependency runs one way. The runner imports the SDK; the SDK never
// imports the runner, so a program that only reads or validates Workflow
// Definitions carries none of the execution machinery.
//
// # Where this code lives
//
// The source of truth is github.com/pedromvgomes/hatua, under source/runner/.
// It is its own Go module, hatua.dev/runner, and requires a released version of
// hatua.dev/go rather than the SDK sources beside it, so it builds against
// exactly what its users fetch.
package runner
