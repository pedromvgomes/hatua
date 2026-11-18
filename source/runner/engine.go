package runner

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	hatua "hatua.dev/go"
	"hatua.dev/go/expressions"
)

// EndVerb is the core verb that stops a run. It has no Handler: the engine
// interprets it, and a run that reaches it succeeds without running the Steps
// after it.
const EndVerb = "core.end"

// corePrefix is the root of every verb Hatua interprets itself.
const corePrefix = "core."

// Errors an Engine reports before it runs anything.
var (
	// ErrNilRegistry reports an Engine constructed without a Registry.
	ErrNilRegistry = errors.New("runner: registry is nil")
	// ErrUnsupportedStep reports a Step the engine cannot execute. It is
	// returned wrapped in an *UnsupportedStepError that names the Step.
	ErrUnsupportedStep = errors.New("step is not executable by this engine")
	// ErrUnknownTrigger reports a run started by a Trigger the Workflow
	// Definition does not declare.
	ErrUnknownTrigger = errors.New("runner: trigger is not declared by the workflow")
)

// InvalidDefinitionError reports a Workflow Definition the SDK's validator
// rejects. Diagnostics holds every diagnostic it raised, in the order the
// rules ran. A definition with any diagnostic is refused, publish-blocking
// ones included, so no Step of it runs.
type InvalidDefinitionError struct {
	Diagnostics []hatua.Diagnostic
}

// Error summarises the diagnostics, naming the first.
func (e *InvalidDefinitionError) Error() string {
	if len(e.Diagnostics) == 0 {
		return "runner: workflow definition is not valid"
	}
	first := e.Diagnostics[0]
	subject := ""
	switch {
	case first.StepID != "":
		subject = fmt.Sprintf(" (step %q)", hatua.StepKey(first.BlockID, first.StepID))
	case first.TriggerID != "":
		subject = fmt.Sprintf(" (trigger %q)", first.TriggerID)
	case first.BlockID != "":
		subject = fmt.Sprintf(" (block %q)", first.BlockID)
	case first.ConnectionID != "":
		subject = fmt.Sprintf(" (connection %q)", first.ConnectionID)
	}
	return fmt.Sprintf("runner: workflow definition is not valid: %d diagnostic(s), first %s%s: %s",
		len(e.Diagnostics), first.Code, subject, first.Message)
}

// MissingHandlersError reports the verbs on the root Board that the Registry
// has no Handler for. Verbs lists each once, in ascending order. It unwraps
// to ErrUnregisteredVerb, so errors.Is matches it as a Registry lookup's
// error would.
type MissingHandlersError struct {
	Verbs []string
}

// Error lists the missing verbs.
func (e *MissingHandlersError) Error() string {
	return fmt.Sprintf("runner: no handler is registered for %s", strings.Join(quoteAll(e.Verbs), ", "))
}

// Unwrap exposes ErrUnregisteredVerb.
func (e *MissingHandlersError) Unwrap() error { return ErrUnregisteredVerb }

// UnsupportedStepError names a Step the engine cannot execute: one whose
// `use` is a core verb other than `core.end` or a block call, or one that
// holds branches, a body or a handler.
type UnsupportedStepError struct {
	StepID string
	Use    string
}

// Error names the Step and its verb.
func (e *UnsupportedStepError) Error() string {
	return fmt.Sprintf("runner: step %q (%s): %v", e.StepID, e.Use, ErrUnsupportedStep)
}

// Unwrap exposes ErrUnsupportedStep.
func (e *UnsupportedStepError) Unwrap() error { return ErrUnsupportedStep }

// StepError reports a Step that failed while the run executed it: its fields
// did not resolve, or its Handler returned an error. Err is that error, as it
// was returned.
type StepError struct {
	StepID string
	Use    string
	Err    error
}

// Error names the Step alongside the reason.
func (e *StepError) Error() string {
	return fmt.Sprintf("runner: step %q (%s): %v", e.StepID, e.Use, e.Err)
}

// Unwrap exposes the cause.
func (e *StepError) Unwrap() error { return e.Err }

// Option configures an Engine.
type Option func(*Engine)

// WithFunctions makes the Host's expression functions callable from every
// Template the engine resolves, alongside Hatua's core functions. A Host
// builds host with expressions.HostFunctions.
func WithFunctions(host expressions.Registry) Option {
	return func(e *Engine) { e.functions = host }
}

// WithRunContext declares the Run Context keys the Host supplies, so the
// validator accepts a `{{run.<k>}}` Reference to them. Without it every
// `run.*` Reference names nothing and the definition is refused.
func WithRunContext(keys []hatua.ContextKey) Option {
	return func(e *Engine) { e.context = slices.Clone(keys) }
}

// Engine runs Workflow Definitions against the Handlers a Host registered.
//
// An Engine executes the root Board's Steps in order. Every Step there must
// be a leaf whose verb has a Handler, or a `core.end`; a definition holding
// any other Step is refused before anything runs, so a run never stops
// halfway because it reached something it cannot execute.
//
// An Engine is safe for concurrent use: each Run builds its own Scope.
type Engine struct {
	registry  *Registry
	manifests []hatua.Manifest
	functions expressions.Registry
	context   []hatua.ContextKey
}

// NewEngine returns an Engine that executes Steps with reg's Handlers and
// validates every definition against manifests, which must declare every
// verb a definition uses, the core ones included.
//
// It returns ErrNilRegistry when reg is nil, and an error when a Host
// function given through WithFunctions shares a name with a core function.
func NewEngine(reg *Registry, manifests []hatua.Manifest, opts ...Option) (*Engine, error) {
	if reg == nil {
		return nil, ErrNilRegistry
	}
	e := &Engine{registry: reg, manifests: slices.Clone(manifests)}
	for _, opt := range opts {
		opt(e)
	}
	if _, err := NewScope(e.functions); err != nil {
		return nil, err
	}
	return e, nil
}

// RunInput is what starts one run.
type RunInput struct {
	// Trigger is the id of the Trigger that fired, which the definition must
	// declare.
	Trigger string
	// Payload is what the Trigger delivered, addressed as
	// `triggers.<Trigger>.…`.
	Payload map[string]any
	// Run is the Host's Run Context, addressed as `run.<k>`.
	Run map[string]any
	// Now is the instant dt.now() reads throughout the run. The zero value
	// means the system clock, read once when the run starts.
	Now time.Time
}

// Run executes def's root Board once.
//
// Before any Step runs, Run refuses the definition, returning a zero Result
// and an error, when:
//
//   - the SDK's validator raises any diagnostic: *InvalidDefinitionError;
//   - a root Board Step is not executable: *UnsupportedStepError;
//   - a root Board verb has no Handler: *MissingHandlersError;
//   - in.Trigger is not a Trigger the definition declares: ErrUnknownTrigger.
//
// Otherwise the Scope starts with the fired Trigger, the Run Context, and
// each root variable's literal `value`, which is not resolved as a Template.
// Each Step then has its `with:` map resolved against the Scope, its Handler
// called, and its output recorded under `steps.<id>`. A `core.end` stops the
// run.
//
// Once Steps have started, Run always returns a Result, and returns its Err
// as the error: nil for StatusSucceeded; a *StepError for StatusFailed; and
// for StatusCancelled an error that wraps ctx.Err(), checked before each Step
// and after a Handler fails.
func (e *Engine) Run(ctx context.Context, def hatua.Definition, in RunInput) (Result, error) {
	handlers, err := e.check(def)
	if err != nil {
		return Result{}, err
	}
	if !slices.ContainsFunc(def.Triggers, func(t hatua.Trigger) bool { return t.ID == in.Trigger }) {
		return Result{}, fmt.Errorf("%w: %q", ErrUnknownTrigger, in.Trigger)
	}

	scope, err := NewScope(e.functions)
	if err != nil {
		return Result{}, err
	}
	scope.SetTrigger(in.Trigger, in.Payload)
	scope.SetRun(in.Run)
	for _, v := range def.Vars {
		scope.SetVar(v.Key, v.Value)
	}
	now := in.Now
	if now.IsZero() {
		now = time.Now()
	}
	scope.SetNow(now)

	result := Result{Steps: []StepResult{}}
	finish := func(status Status, failed string, err error) (Result, error) {
		result.Status, result.FailedStep, result.Err = status, failed, err
		return result, err
	}

	for _, step := range def.Steps {
		if ctxErr := ctx.Err(); ctxErr != nil {
			return finish(StatusCancelled, "", fmt.Errorf("runner: run cancelled before step %q: %w", step.ID, ctxErr))
		}
		if step.Use == EndVerb {
			result.Steps = append(result.Steps, StepResult{ID: step.ID, Use: step.Use})
			result.Ended = true
			return finish(StatusSucceeded, "", nil)
		}

		fields, err := scope.ResolveFields(step.With)
		if err != nil {
			return finish(StatusFailed, step.ID, &StepError{StepID: step.ID, Use: step.Use, Err: err})
		}
		out, err := handlers[step.Use](ctx, fields)
		if err != nil {
			stepErr := &StepError{StepID: step.ID, Use: step.Use, Err: err}
			if ctxErr := ctx.Err(); ctxErr != nil {
				if errors.Is(err, ctxErr) {
					return finish(StatusCancelled, step.ID, fmt.Errorf("runner: run cancelled: %w", stepErr))
				}
				return finish(StatusCancelled, step.ID, fmt.Errorf("runner: run cancelled: %w: %w", ctxErr, stepErr))
			}
			return finish(StatusFailed, step.ID, stepErr)
		}
		scope.RecordOutput(step.ID, out)
		result.Steps = append(result.Steps, StepResult{ID: step.ID, Use: step.Use, Output: out})
	}
	return finish(StatusSucceeded, "", nil)
}

// check refuses a definition the engine must not start: one the validator
// rejects, one holding a Step the engine cannot execute, or one using a verb
// with no Handler. Only the root Board is checked for the last two, since no
// Step that could enter a block is accepted.
//
// It returns the Handler for every verb on the root Board, looked up once, so
// the run executes exactly the Handlers it checked.
func (e *Engine) check(def hatua.Definition) (map[string]Handler, error) {
	validity := hatua.ValidateDefinition(def, e.manifests, hatua.Inputs{Context: e.context})
	if len(validity.All) > 0 {
		return nil, &InvalidDefinitionError{Diagnostics: validity.All}
	}

	for _, step := range def.Steps {
		if !executable(step) {
			return nil, &UnsupportedStepError{StepID: step.ID, Use: step.Use}
		}
	}

	handlers := map[string]Handler{}
	var missing []string
	hatua.WalkSteps(def.Steps, func(step hatua.Step) {
		if step.Use == EndVerb || handlers[step.Use] != nil || slices.Contains(missing, step.Use) {
			return
		}
		h, err := e.registry.Lookup(step.Use)
		if err != nil {
			missing = append(missing, step.Use)
			return
		}
		handlers[step.Use] = h
	})
	if len(missing) > 0 {
		slices.Sort(missing)
		return nil, &MissingHandlersError{Verbs: missing}
	}
	return handlers, nil
}

// executable reports whether the engine can run step: a leaf whose verb is
// either `core.end` or neither a core verb nor a block call.
func executable(step hatua.Step) bool {
	if len(step.Branches) > 0 || len(step.Steps) > 0 || len(step.Handler) > 0 {
		return false
	}
	if step.Use == EndVerb {
		return true
	}
	if _, call := hatua.BlockIDOf(step.Use); call {
		return false
	}
	return !strings.HasPrefix(step.Use, corePrefix)
}

func quoteAll(values []string) []string {
	out := make([]string, len(values))
	for i, v := range values {
		out[i] = fmt.Sprintf("%q", v)
	}
	return out
}
