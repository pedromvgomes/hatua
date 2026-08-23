package hatua

import "strings"

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
	Blocks      []Block      `yaml:"blocks,omitempty"`
	Steps       []Step       `yaml:"steps"`
}

// Block is a named, reusable sequence invoked as `use: block.<id>`.
//
// It reads only what it declares plus the Run Context — not the workflow's
// triggers, not its vars. That contract is what lets a block be reached from
// many call sites while scope stays an exact walk rather than an intersection
// over paths, which is the whole distinction between a call and a jump
// (ADR-0013).
//
// Step ids are scoped to the block, so two blocks may each hold a step called
// `ret`, and its own Vars are rebuilt on every invocation.
type Block struct {
	ID      string        `yaml:"id"`
	Name    string        `yaml:"name,omitempty"`
	Params  []Declaration `yaml:"params,omitempty"`
	Outputs []Declaration `yaml:"outputs,omitempty"`
	Vars    []Variable    `yaml:"vars,omitempty"`
	Steps   []Step        `yaml:"steps"`
}

// Declaration is one parameter or one output. Spelled {k, label, t, of} exactly
// as a Component Manifest's output and a Run Context key are, so outputsToType
// types a parameter with no new code.
//
// T deliberately excludes `item`: that is the for-each escape hatch, resolved by
// following a loop's list back to its source output, and a parameter is not the
// output of anything.
type Declaration struct {
	K     string        `yaml:"k"`
	Label string        `yaml:"label"`
	T     string        `yaml:"t"`
	Of    []Declaration `yaml:"of,omitempty"`
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

// BoardID says which Board a step sits on: a block's id, or "" for the root.
//
// A string rather than a pointer because "" cannot be a block id — the schema
// holds every id to an identifier, which is non-empty by construction.
type BoardID = string

// RootBoard is the Board whose root is the workflow's triggers.
const RootBoard BoardID = ""

// Board is one drawable step tree and the root that gives it its parameters.
type Board struct {
	ID    BoardID
	Block *Block
	Steps []Step
}

// Boards returns every Board in the document, root first.
//
// This is the traversal that cannot forget a block. Anything walking d.Steps
// alone sees a document with three blocks in it and reports nothing about any of
// them, silently.
func Boards(d Definition) []Board {
	boards := []Board{{ID: RootBoard, Steps: d.Steps}}
	for i := range d.Blocks {
		block := &d.Blocks[i]
		boards = append(boards, Board{ID: block.ID, Block: block, Steps: block.Steps})
	}
	return boards
}

// BoardOf returns one Board by id, or nil when nothing declares it.
//
// Built directly rather than by scanning Boards: a runner calls ScopeFor once
// per step, and each call reaches here — materialising the whole slice to read
// one entry allocates a Board per block, per step, per execution.
func BoardOf(d Definition, id BoardID) *Board {
	if id == RootBoard {
		return &Board{ID: RootBoard, Steps: d.Steps}
	}
	block := BlockOf(d, id)
	if block == nil {
		return nil
	}
	return &Board{ID: block.ID, Block: block, Steps: block.Steps}
}

// StepRef names one step. Neither half identifies one alone: ids are
// Board-local, so two blocks may each hold a `ret`.
type StepRef struct {
	Board BoardID
	ID    string
}

// WalkDocument visits every step on every Board, tagged with the Board it is on.
func WalkDocument(d Definition, visit func(StepRef, Step)) {
	for _, board := range Boards(d) {
		WalkSteps(board.Steps, func(s Step) { visit(StepRef{Board: board.ID, ID: s.ID}, s) })
	}
}

// BlockPrefix is the verb root that says a step calls a block in this document.
const BlockPrefix = "block."

// ReturnVerb publishes a block's declared outputs and ends it. ForkVerb and
// ForEachVerb are the other two Hatua reads structurally: their shape is a
// position in the document rather than a field under `with:`, so no manifest
// can describe them.
const (
	ReturnVerb  = "core.return"
	ForkVerb    = "core.fork"
	ForEachVerb = "core.for_each"
)

// CallsOf reports which blocks a step list reaches directly, in document order.
//
// Reads the whole board rather than its top level: a call nested inside a fork
// branch or a loop body still reaches, which is the entire point of asking.
func CallsOf(steps []Step) []string {
	found := []string{}
	var walk func([]Step)
	walk = func(list []Step) {
		for _, step := range list {
			if id, ok := BlockIDOf(step.Use); ok {
				found = append(found, id)
			}
			for _, branch := range step.Branches {
				walk(branch.Steps)
			}
			walk(step.Steps)
		}
	}
	walk(steps)
	return found
}

// CyclicBlocks reports the blocks that take part in a cycle, in declaration
// order.
//
// ADR-0013 refuses recursion, so this is a design-time answer rather than a
// depth limit a runner discovers. Direct and indirect are one question: a block
// that reaches itself through any chain is in a cycle, and a colour-marked
// depth-first walk answers both without a second traversal.
func CyclicBlocks(doc Definition) []string {
	// First-wins, matching BlockOf — letting the LAST block under a repeated id
	// decide what the call graph is would analyse recursion against one block's
	// steps while every other reader acts on the first.
	edges := map[string][]string{}
	order := []string{}
	for _, block := range doc.Blocks {
		if _, held := edges[block.ID]; held {
			continue
		}
		edges[block.ID] = CallsOf(block.Steps)
		order = append(order, block.ID)
	}

	cyclic := map[string]bool{}
	visiting := map[string]bool{}
	done := map[string]bool{}

	var visit func(string, []string)
	visit = func(id string, path []string) {
		if visiting[id] {
			// Everything from where this id first appears is on the cycle; what
			// came before merely leads to it and is not itself recursive.
			for i, member := range path {
				if member == id {
					for _, onCycle := range path[i:] {
						cyclic[onCycle] = true
					}
					break
				}
			}
			return
		}
		if done[id] {
			return
		}
		if _, declared := edges[id]; !declared {
			return
		}

		visiting[id] = true
		for _, next := range edges[id] {
			visit(next, append(append([]string{}, path...), id))
		}
		visiting[id] = false
		done[id] = true
	}

	for _, id := range order {
		visit(id, nil)
	}

	// Declaration order, so both languages report the same document the same way.
	found := []string{}
	for _, id := range order {
		if cyclic[id] {
			found = append(found, id)
		}
	}
	return found
}

// BlockIDOf returns the block a verb names, and whether it names one at all.
func BlockIDOf(use string) (string, bool) {
	if !strings.HasPrefix(use, BlockPrefix) {
		return "", false
	}
	return strings.TrimPrefix(use, BlockPrefix), true
}

// BlockOf returns one block by id, or nil.
func BlockOf(d Definition, id string) *Block {
	for i := range d.Blocks {
		if d.Blocks[i].ID == id {
			return &d.Blocks[i]
		}
	}
	return nil
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
