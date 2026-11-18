package runner

// Status says how a run finished.
type Status string

const (
	// StatusSucceeded is a run that executed every Step on the root Board, or
	// stopped at a `core.end`.
	StatusSucceeded Status = "succeeded"
	// StatusFailed is a run stopped by a Step whose fields did not resolve or
	// whose Handler returned an error.
	StatusFailed Status = "failed"
	// StatusCancelled is a run stopped because its context was cancelled or
	// its deadline passed.
	StatusCancelled Status = "cancelled"
)

// StepResult is one Step that completed: its id, the verb it used, and the
// output its Handler returned. A `core.end` has no Handler, so its Output is
// nil.
type StepResult struct {
	ID     string
	Use    string
	Output map[string]any
}

// Result describes one run that started executing Steps.
//
// Steps lists every Step that completed, in the order it ran. A Step that
// failed, or that was running when the context was cancelled, is not among
// them: FailedStep names it instead.
type Result struct {
	Status Status
	Steps  []StepResult
	// FailedStep is the id of the Step that stopped the run: the one that
	// failed, or the one running when the context was cancelled. It is empty
	// when the run succeeded or was cancelled between Steps.
	FailedStep string
	// Err is why the run did not succeed, and the same error Engine.Run
	// returns. It is nil when Status is StatusSucceeded.
	Err error
	// Ended reports that the run stopped at a `core.end` rather than by
	// running out of Steps.
	Ended bool
}
