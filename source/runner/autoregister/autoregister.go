// Package autoregister collects the handlers a node package contributes from
// its init function, so a Host registers them by importing the package for its
// side effects and then applying the collected set to a Registry it owns.
//
// The engine holds no global registry. The collection in this package is the
// only package-level state, and nothing reads it except Apply, which the Host
// calls explicitly:
//
//	import _ "example.com/nodes/http" // its init calls autoregister.Add
//
//	r := runner.NewRegistry()
//	if err := autoregister.Apply(r); err != nil {
//		return err
//	}
package autoregister

import (
	"errors"
	"sync"

	"hatua.dev/runner"
)

// entry registers one collected handler into a Registry.
type entry func(r *runner.Registry) error

var (
	mu      sync.Mutex
	entries []entry
)

func add(e entry) {
	mu.Lock()
	defer mu.Unlock()
	entries = append(entries, e)
}

// Add collects h under verb. It never fails and never panics: an empty verb, a
// nil h, or a verb collected twice is reported by Apply, as the Registry
// reports it.
//
// Add is safe for concurrent use. Package init functions run one after
// another, so calls made from init are also ordered by import order.
func Add(verb string, h runner.Handler) {
	add(func(r *runner.Registry) error { return r.Register(verb, h) })
}

// AddNode collects n under verb. It is adapted to a Handler when Apply
// registers it, so a type the decoder cannot fill, or a nil n, is reported by
// Apply as runner.RegisterNode reports it.
//
// AddNode is safe for concurrent use.
func AddNode[In, Out any](verb string, n runner.Node[In, Out]) {
	add(func(r *runner.Registry) error { return runner.RegisterNode(r, verb, n) })
}

// Apply registers every collected handler into r, in the order they were
// collected. A handler that cannot be registered does not stop the others: the
// errors of all of them come back joined, each a *runner.VerbError, so
// errors.Is and errors.As see every one. It returns nil when all registered.
//
// Apply does not drain the collection: it may be called with several
// Registries, and each receives the full set. A Registry that already holds a
// collected verb reports runner.ErrDuplicateVerb for it.
func Apply(r *runner.Registry) error {
	mu.Lock()
	pending := make([]entry, len(entries))
	copy(pending, entries)
	mu.Unlock()

	var errs []error
	for _, e := range pending {
		if err := e(r); err != nil {
			errs = append(errs, err)
		}
	}
	return errors.Join(errs...)
}
