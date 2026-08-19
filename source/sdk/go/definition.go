package hatua

// Types mirroring schemas/workflow-definition.schema.yaml.
//
// Hand-written for now rather than generated: the Go SDK is a scaffold, and the
// conformance corpus — not codegen — is what proves these agree with the
// TypeScript side. Generation lands when the SDK grows past this.

// Status of one version. A workflow has at most one Published and at most one
// Draft at a time; publishing archives the outgoing version.
type Status string

const (
	StatusPublished Status = "published"
	StatusDraft     Status = "draft"
	StatusArchived  Status = "archived"
)

// Definition is a Workflow Definition — read and written by the builder.
type Definition struct {
	ID      string `yaml:"id"`
	Name    string `yaml:"name"`
	Version int    `yaml:"version"`
	Status  Status `yaml:"status"`

	Connections []Connection `yaml:"connections,omitempty"`
	Triggers    []Trigger    `yaml:"triggers,omitempty"`
	Vars        []Variable   `yaml:"vars,omitempty"`
	Steps       []Step       `yaml:"steps"`
}

// Connection holds only an opaque handle. Everything shown to a user comes from
// the Host describing that ref, so nothing cached here can go stale. A nil Ref
// means the connection was never established, which blocks publish but not
// editing.
type Connection struct {
	ID  string  `yaml:"id"`
	Ref *string `yaml:"ref"`
}

// Trigger starts a workflow. Triggers are not Steps: a workflow may declare
// several, addressed by name, and their declared outputs are the workflow's
// parameter contract.
type Trigger struct {
	ID   string         `yaml:"id"`
	Use  string         `yaml:"use"`
	Name string         `yaml:"name,omitempty"`
	With map[string]any `yaml:"with,omitempty"`
}

// Variable is workflow-scoped mutable state. A list rather than a map so a type
// or label can be added later without breaking every existing file.
type Variable struct {
	Key   string `yaml:"key"`
	Value any    `yaml:"value"`
}

// Step is one node of the tree. Steps nest through Branches (forks) and Steps
// (loops); they are never an arbitrary graph. There is no position data, by
// design — layout is derived on every render.
type Step struct {
	ID       string         `yaml:"id"`
	Use      string         `yaml:"use"`
	Name     string         `yaml:"name,omitempty"`
	With     map[string]any `yaml:"with,omitempty"`
	Branches []Branch       `yaml:"branches,omitempty"`
	Steps    []Step         `yaml:"steps,omitempty"`
}

// Branch is one labelled path of a fork. Order matters in a condition fork:
// first match wins, and the final branch may be unconditional.
type Branch struct {
	Label string `yaml:"label"`
	When  string `yaml:"when,omitempty"`
	Steps []Step `yaml:"steps"`
}

// WalkSteps visits every step depth-first, parents before children.
func WalkSteps(steps []Step, visit func(Step)) {
	for _, step := range steps {
		visit(step)
		for _, branch := range step.Branches {
			WalkSteps(branch.Steps, visit)
		}
		WalkSteps(step.Steps, visit)
	}
}
