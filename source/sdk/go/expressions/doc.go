// Package expressions implements Hatua's `{{ … }}` expression language: the
// grammar's generated parser, the type checker, and the resolver a runner calls
// to turn a step's templates into values.
//
// It is the Go half of a contract. `@hatua/expressions` is the other half, and
// conformance/expression/ is what keeps the two honest — an evaluator agreeing
// on syntax but disagreeing on null handling or numeric formatting produces a
// workflow that looks correct in the builder and does the wrong thing in
// production.
//
// Files ending `.gen.go` are written by tools/expression and must never be
// hand-edited.
package expressions
