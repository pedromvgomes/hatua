package runner

import (
	"errors"
	"fmt"
	"maps"
	"slices"
	"strings"
	"sync"
	"time"

	hatua "hatua.dev/go"
	"hatua.dev/go/expressions"
)

// Scope is everything an expression can address during one run: the Trigger
// that fired, the parameters a Block was called with, the Host's Run Context,
// the Board's variables, and the output of every Step that has run.
//
// Each part sits under its own closed root, exactly as the SDK's validator
// names it, so a Workflow Definition the validator accepts addresses the same
// paths here:
//
//	triggers.<id>.…   the fired Trigger's payload
//	TRIGGER           the id of the Trigger that fired
//	params.<k>        a Block Board's parameters
//	run.<k>           the Host's Run Context
//	var.<key>         the Board's variables
//	steps.<id>.…      a Step's recorded output
//
// A path that names nothing is an error, not null: the evaluator runs with
// its default OnMissing, so a Reference to a Step that has not run fails
// loudly rather than resolving to empty. A key that is present and holds nil
// resolves to nil.
//
// A Scope belongs to a single run. It is safe for concurrent use, so Steps
// running on parallel branches may record outputs while others resolve their
// fields.
type Scope struct {
	mu        sync.RWMutex
	trigger   string
	triggers  map[string]any
	params    map[string]any
	run       map[string]any
	vars      map[string]any
	steps     map[string]any
	now       *time.Time
	functions expressions.Registry
}

// NewScope returns an empty Scope whose expressions can call Hatua's core
// functions and the Host's functions in host, which may be nil. A Host builds
// host with expressions.HostFunctions. A Host function that shares a qualified
// name with a core function is an error, because either winner would make the
// Workflow's behaviour depend on which registry was consulted first.
func NewScope(host expressions.Registry) (*Scope, error) {
	functions, err := expressions.MergeRegistries(expressions.CoreFunctions(), host)
	if err != nil {
		return nil, fmt.Errorf("runner: host functions: %w", err)
	}
	return &Scope{functions: functions}, nil
}

// SetTrigger records which Trigger fired and its payload, addressed as
// `triggers.<id>.…` and `TRIGGER`. A run is started by exactly one Trigger, so
// this replaces any Trigger set before it.
func (s *Scope) SetTrigger(id string, payload map[string]any) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.trigger = id
	s.triggers = map[string]any{id: expressions.Normalize(payload)}
}

// SetParams replaces the parameters a Block Board was called with, addressed
// as `params.<k>`.
func (s *Scope) SetParams(params map[string]any) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.params = normalizeMap(params)
}

// SetRun replaces the Host's Run Context, addressed as `run.<k>`.
func (s *Scope) SetRun(run map[string]any) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.run = normalizeMap(run)
}

// SetVar sets one variable, addressed as `var.<key>`.
func (s *Scope) SetVar(key string, value any) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.vars == nil {
		s.vars = make(map[string]any)
	}
	s.vars[key] = expressions.Normalize(value)
}

// RecordOutput records a Step's output, addressed as `steps.<stepID>.…`.
// Recording the same Step again replaces its output.
func (s *Scope) RecordOutput(stepID string, output map[string]any) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.steps == nil {
		s.steps = make(map[string]any)
	}
	s.steps[stepID] = expressions.Normalize(output)
}

// SetNow fixes the instant dt.now() reads. Without it dt.now() fails: the
// evaluator never reads the system clock, so every Step in one run agrees on
// when "now" is.
func (s *Scope) SetNow(now time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.now = &now
}

// Context returns a snapshot of the Scope as an expressions.Context. Its
// top-level maps are copies, so a later Set or RecordOutput does not change
// a Context already handed out.
func (s *Scope) Context() expressions.Context {
	s.mu.RLock()
	defer s.mu.RUnlock()
	ctx := expressions.Context{
		Triggers:  maps.Clone(s.triggers),
		Params:    maps.Clone(s.params),
		Run:       maps.Clone(s.run),
		Vars:      maps.Clone(s.vars),
		Steps:     maps.Clone(s.steps),
		Trigger:   s.trigger,
		OnMissing: expressions.OnMissingError,
		Functions: s.functions,
	}
	if s.now != nil {
		now := *s.now
		ctx.Now = &now
	}
	return ctx
}

// TemplateError reports a field whose Template did not resolve. Field is the
// field's path within the Step's `with:` map — `subject`, `body.title`,
// `to[1]` — and Err is the *expressions.Error the evaluator returned, whose
// diagnostics carry the same path as their Slot.
type TemplateError struct {
	Field string
	Err   error
}

// Error names the field alongside the reason.
func (e *TemplateError) Error() string {
	return fmt.Sprintf("runner: field %s: %v", e.Field, e.Err)
}

// Unwrap exposes the evaluator's error, so errors.As recovers its diagnostics.
func (e *TemplateError) Unwrap() error { return e.Err }

// ResolveStep resolves a Component Step's `with:` map against the Scope, typed
// by manifest, the Component Manifest that declares the Step's verb.
//
// A field holds a Template only when the manifest declares it with a kind
// hatua.FieldKindTypes maps, and its Slot is the one hatua.SlotsFor builds, so
// the evaluator checks and coerces each value against the declared type: a
// single-hole Template in a `text` field that evaluates to a number arrives as
// the text "3", not the number 3.
//
// A `map` field arrives as one object keyed by its entries' keys, each value
// resolved against the type its own entry declares. An entry that is not a
// well-formed `{key, value, type}` is dropped, as hatua.MapEntries drops it.
//
// Every other value passes through unchanged: a field of a literal kind, a
// non-string value in a mappable field, and a key the manifest does not
// declare, none of which the validator checks as a Template. A blank Template
// in a field whose type text cannot satisfy resolves to nil, because the
// validator accepts it as "left empty" and the evaluator would refuse "".
// The input is never modified.
//
// Every failing Slot is reported, as ResolveFields reports a field: a
// *TemplateError named by the Slot — `<field>`, or `<field>.<key>` for a map
// entry — alone or joined with the others in path order.
func (s *Scope) ResolveStep(step hatua.Step, manifest hatua.Manifest) (map[string]any, error) {
	ctx := s.Context()
	slots := hatua.SlotsFor(step, manifest)
	resolved := make(map[string]any, len(slots))
	var failures []*TemplateError
	for _, slot := range slots {
		value, err := resolveSlot(ctx, slot)
		if err != nil {
			failures = append(failures, &TemplateError{Field: slot.Name, Err: err})
			continue
		}
		resolved[slot.Name] = value
	}
	if len(failures) > 0 {
		slices.SortStableFunc(failures, func(a, b *TemplateError) int { return strings.Compare(a.Field, b.Field) })
		if len(failures) == 1 {
			return nil, failures[0]
		}
		errs := make([]error, len(failures))
		for i, failure := range failures {
			errs[i] = failure
		}
		return nil, errors.Join(errs...)
	}

	out := make(map[string]any, len(step.With))
	maps.Copy(out, step.With)
	for _, field := range manifest.Fields {
		value, present := step.With[field.K]
		if !present {
			continue
		}
		if field.Kind == "map" {
			object := map[string]any{}
			for _, entry := range hatua.MapEntries(value) {
				object[entry.Key] = resolved[field.K+"."+entry.Key]
			}
			out[field.K] = object
			continue
		}
		if value, ok := resolved[field.K]; ok {
			out[field.K] = value
		}
	}
	return out, nil
}

// resolveSlot resolves one typed Slot against ctx. A blank Template whose
// expected type text does not satisfy resolves to nil: the validator skips a
// blank Template as a field left empty, and resolving it would produce "" and
// fail the type check the validator never ran.
func resolveSlot(ctx expressions.Context, slot expressions.Slot) (any, error) {
	if strings.TrimSpace(slot.Template) == "" && !expressions.Satisfies("", slot.ExpectedType) {
		return nil, nil
	}
	return expressions.Resolve(ctx, slot)
}

// ResolveFields resolves a field map against the Scope with no declared
// types, for a caller that has no Component Manifest to type it by.
// ResolveStep is the typed path the Engine takes.
//
// Every string is a Template: one that is exactly a single `{{ … }}` keeps
// the expression's own type, and any other renders as text. Maps and lists
// are resolved element by element; every other value passes through
// unchanged. The input is never modified.
//
// Every failing field is reported, not just the first: the error is a
// *TemplateError when one field fails, and the errors.Join of one *TemplateError
// per failing field, in path order, when several do.
func (s *Scope) ResolveFields(fields map[string]any) (map[string]any, error) {
	ctx := s.Context()
	var failures []error
	out := make(map[string]any, len(fields))
	for _, key := range slices.Sorted(maps.Keys(fields)) {
		out[key] = resolveValue(ctx, key, fields[key], &failures)
	}
	switch len(failures) {
	case 0:
		return out, nil
	case 1:
		return nil, failures[0]
	}
	return nil, errors.Join(failures...)
}

// resolveValue resolves one field value at path, appending a *TemplateError to
// failures for each Template beneath it that does not resolve.
func resolveValue(ctx expressions.Context, path string, value any, failures *[]error) any {
	switch v := value.(type) {
	case string:
		resolved, err := expressions.Resolve(ctx, expressions.Slot{
			Name:         path,
			Template:     v,
			ExpectedType: expressions.TypeUnknown,
		})
		if err != nil {
			*failures = append(*failures, &TemplateError{Field: path, Err: err})
			return nil
		}
		return resolved
	case map[string]any:
		out := make(map[string]any, len(v))
		for _, key := range slices.Sorted(maps.Keys(v)) {
			out[key] = resolveValue(ctx, joinField(path, key), v[key], failures)
		}
		return out
	case []any:
		out := make([]any, len(v))
		for i, item := range v {
			out[i] = resolveValue(ctx, joinIndex(path, i), item, failures)
		}
		return out
	}
	return value
}

// normalizeMap brings a map's values into the expression value space, where
// every number is a float64. A YAML or JSON decoder hands over ints, and an
// operator in the evaluator asserts float64.
func normalizeMap(source map[string]any) map[string]any {
	if source == nil {
		return nil
	}
	return expressions.Normalize(source).(map[string]any)
}
