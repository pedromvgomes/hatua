package runner

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"sync"
)

// Handler executes one Step. It receives the Step's fields with every
// Reference and expression already resolved, and returns the Step's output,
// which later Steps reach through References.
//
// A Handler is called for every Step whose `use` names the verb it is
// registered under, possibly from several goroutines at once, so it must be
// safe for concurrent use.
type Handler func(ctx context.Context, fields map[string]any) (map[string]any, error)

// Errors a Registry reports. Each is returned wrapped in a *VerbError that
// names the verb, so callers match the kind with errors.Is and recover the
// verb with errors.As.
var (
	// ErrEmptyVerb reports a registration under the empty verb, which no
	// Step's `use` can name.
	ErrEmptyVerb = errors.New("verb is empty")
	// ErrNilHandler reports a registration with a nil Handler.
	ErrNilHandler = errors.New("handler is nil")
	// ErrDuplicateVerb reports a registration under a verb that already has a
	// Handler. The first registration stands.
	ErrDuplicateVerb = errors.New("verb is already registered")
	// ErrUnregisteredVerb reports a lookup of a verb with no Handler.
	ErrUnregisteredVerb = errors.New("verb is not registered")
)

// VerbError is the error a Registry returns: Err says what went wrong, and
// Verb names the verb it went wrong for.
type VerbError struct {
	Verb string
	Err  error
}

// Error renders the verb alongside the reason.
func (e *VerbError) Error() string {
	return fmt.Sprintf("runner: verb %q: %v", e.Verb, e.Err)
}

// Unwrap exposes the sentinel, so errors.Is matches it.
func (e *VerbError) Unwrap() error { return e.Err }

// Registry maps each verb a Host offers to the Handler that executes it. The
// engine reads handlers only from the Registry it is given; there is no
// package-level registry.
//
// The zero value is an empty Registry ready for use. A Registry is safe for
// concurrent use: Register, Lookup and Verbs may be called from any number of
// goroutines. The intended shape is to register every verb before running a
// Workflow and only look up afterwards, but nothing breaks if registration
// and lookup interleave. A Registry must not be copied after first use.
type Registry struct {
	mu       sync.RWMutex
	handlers map[string]Handler
}

// NewRegistry returns an empty Registry.
func NewRegistry() *Registry {
	return &Registry{}
}

// Register makes h the Handler for verb. It returns a *VerbError wrapping
// ErrEmptyVerb when verb is empty, ErrNilHandler when h is nil, and
// ErrDuplicateVerb when verb already has a Handler; in each case the Registry
// is left unchanged.
func (r *Registry) Register(verb string, h Handler) error {
	if verb == "" {
		return &VerbError{Verb: verb, Err: ErrEmptyVerb}
	}
	if h == nil {
		return &VerbError{Verb: verb, Err: ErrNilHandler}
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.handlers[verb]; ok {
		return &VerbError{Verb: verb, Err: ErrDuplicateVerb}
	}
	if r.handlers == nil {
		r.handlers = make(map[string]Handler)
	}
	r.handlers[verb] = h
	return nil
}

// Lookup returns the Handler registered for verb. When there is none it
// returns a *VerbError wrapping ErrUnregisteredVerb.
func (r *Registry) Lookup(verb string) (Handler, error) {
	r.mu.RLock()
	h, ok := r.handlers[verb]
	r.mu.RUnlock()
	if !ok {
		return nil, &VerbError{Verb: verb, Err: ErrUnregisteredVerb}
	}
	return h, nil
}

// Verbs returns every registered verb in ascending order. The slice is the
// caller's to keep; it does not track later registrations.
func (r *Registry) Verbs() []string {
	r.mu.RLock()
	verbs := make([]string, 0, len(r.handlers))
	for verb := range r.handlers {
		verbs = append(verbs, verb)
	}
	r.mu.RUnlock()
	slices.Sort(verbs)
	return verbs
}
