package hatua

// Types mirroring schemas/workflow-execution.schema.yaml.

// RunStatus is the outcome of a whole run.
type RunStatus string

const (
	RunRunning   RunStatus = "running"
	RunSucceeded RunStatus = "succeeded"
	RunFailed    RunStatus = "failed"
)

// StepStatus is the outcome of one step, or one loop iteration.
type StepStatus string

const (
	StepPending   StepStatus = "pending"
	StepRunning   StepStatus = "running"
	StepSucceeded StepStatus = "succeeded"
	StepFailed    StepStatus = "failed"
	StepSkipped   StepStatus = "skipped"
)

// Execution records one run. It references its Definition by version rather
// than embedding it: painting an old run against today's definition would put
// durations on steps that did not exist and silently drop steps that did.
//
// There is no run-level metadata field, deliberately. Totals and pivots are
// derived from the per-step values below using the measure/dimension roles the
// component manifests declare, so runners do not each invent a summary shape.
type Execution struct {
	RunID      string        `yaml:"run_id"`
	Status     RunStatus     `yaml:"status"`
	Workflow   WorkflowRef   `yaml:"workflow"`
	Trigger    *TriggerFired `yaml:"trigger,omitempty"`
	StartedAt  string        `yaml:"started_at"`
	FinishedAt string        `yaml:"finished_at,omitempty"`
	DurationMS float64       `yaml:"duration_ms,omitempty"`
	Steps      []StepRun     `yaml:"steps"`
	Log        []LogEntry    `yaml:"log,omitempty"`
}

// WorkflowRef resolves through the Host's version store.
type WorkflowRef struct {
	ID      string `yaml:"id"`
	Version int    `yaml:"version"`
}

// TriggerFired names which declared trigger started this run.
type TriggerFired struct {
	ID      string         `yaml:"id"`
	Payload map[string]any `yaml:"payload,omitempty"`
}

// StepRun is one step's result. Iterations is populated only for loops: a
// for-each runs its children once per item, so a flat step list could not
// express "succeeded 23 times and failed once".
type StepRun struct {
	ID            string         `yaml:"id"`
	Status        StepStatus     `yaml:"status"`
	DurationMS    float64        `yaml:"duration_ms,omitempty"`
	ResolvedInput any            `yaml:"resolved_input,omitempty"`
	Output        any            `yaml:"output,omitempty"`
	Metadata      map[string]any `yaml:"metadata,omitempty"`
	Error         *RunError      `yaml:"error,omitempty"`
	Iterations    []Iteration    `yaml:"iterations,omitempty"`
}

// Iteration is one pass of a loop.
type Iteration struct {
	Index      int        `yaml:"index"`
	Status     StepStatus `yaml:"status"`
	DurationMS float64    `yaml:"duration_ms,omitempty"`
	Steps      []StepRun  `yaml:"steps,omitempty"`
	Error      *RunError  `yaml:"error,omitempty"`
}

// RunError carries a stable machine code alongside the message, so a UI can
// react without parsing prose.
type RunError struct {
	Message string `yaml:"message"`
	Code    string `yaml:"code,omitempty"`
}

// LogEntry is one line of run output.
type LogEntry struct {
	At      string `yaml:"at"`
	Step    string `yaml:"step,omitempty"`
	Channel string `yaml:"channel,omitempty"`
	Message string `yaml:"message"`
}
