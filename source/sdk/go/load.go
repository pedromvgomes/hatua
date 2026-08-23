package hatua

import (
	"fmt"
	"regexp"

	"gopkg.in/yaml.v3"
)

// Parse-and-validate helpers. A runner should never hand itself an unvalidated
// document: the builder guarantees what it wrote, but a file can be hand-edited
// between publish and run.
//
// KnownFields is enabled so an unknown key is an error rather than being
// silently dropped — the Go equivalent of the schema's additionalProperties:
// false, and the reason a stale `inputs:` section fails loudly here too.

func decode(data []byte, into any, what string) error {
	dec := yaml.NewDecoder(newReader(data))
	dec.KnownFields(true)
	if err := dec.Decode(into); err != nil {
		return fmt.Errorf("not a valid %s: %w", what, err)
	}
	return nil
}

// LoadDefinition parses and validates a Workflow Definition.
func LoadDefinition(data []byte) (*Definition, error) {
	var doc Definition
	if err := decode(data, &doc, "Workflow Definition"); err != nil {
		return nil, err
	}
	if err := doc.Validate(); err != nil {
		return nil, err
	}
	return &doc, nil
}

// LoadExecution parses a Workflow Execution.
func LoadExecution(data []byte) (*Execution, error) {
	var run Execution
	if err := decode(data, &run, "Workflow Execution"); err != nil {
		return nil, err
	}
	return &run, nil
}

// LoadManifests accepts either a single manifest or a components: catalogue,
// returning a flat list.
//
// Catalogue-ness is decided by whether the document HAS a components key, not
// by whether that key is non-empty. A Host with no custom components yet
// legitimately serves `components: []`, and treating that as a single manifest
// fails with a baffling error while the builder is perfectly happy.
func LoadManifests(data []byte) ([]Manifest, error) {
	var probe struct {
		Components *[]Manifest `yaml:"components"`
	}
	if err := yaml.Unmarshal(data, &probe); err == nil && probe.Components != nil {
		var catalogue Catalogue
		if err := decode(data, &catalogue, "Component Manifest"); err != nil {
			return nil, err
		}
		if catalogue.Components == nil {
			return []Manifest{}, nil
		}
		return catalogue.Components, nil
	}

	var single Manifest
	if err := decode(data, &single, "Component Manifest"); err != nil {
		return nil, err
	}
	return []Manifest{single}, nil
}

// LoadRunContext parses a Run Context Manifest: the ambient values the Host
// supplies to every execution.
//
// No catalogue variant to probe for, unlike LoadManifests. There is exactly one
// Run Context per execution, so the file declares keys directly and a second
// declaration is a mistake rather than a longer list.
func LoadRunContext(data []byte) (*RunContextManifest, error) {
	var manifest RunContextManifest
	if err := decode(data, &manifest, "Run Context Manifest"); err != nil {
		return nil, err
	}
	return &manifest, nil
}

// Validate covers every key the schema marks required. It must reject exactly
// what the TypeScript side rejects: a document Go accepts and zod refuses is a
// workflow that fails in the builder and runs anyway, which is the divergence
// this SDK exists to prevent. conformance/definition/invalid/ pins each case.
//
// Cross-field rules belong to the builder's model layer (@hatua/model) and are
// not duplicated here: connection type matching, empty loops, unmapped required
// fields, and — for a block — a call naming nothing, a call graph with a cycle,
// a path that finishes without returning, two blocks under one id, two steps
// under one id on a board, and two declarations under one key. A runner linking
// this package gets shape, not those rules, so a document reaching it
// unvalidated by a builder can still hold a block that calls itself, and can
// hold a repeated id that Boards and WalkDocument both yield while BlockOf and
// ScopeFor resolve first-wins.
func (d *Definition) Validate() error {
	const prefix = "not a valid Workflow Definition"

	if d.ID == "" {
		return fmt.Errorf("%s: id is required", prefix)
	}
	if d.Name == "" {
		return fmt.Errorf("%s: name is required", prefix)
	}
	if d.Version < 1 {
		return fmt.Errorf("%s: version must be at least 1, got %d", prefix, d.Version)
	}
	switch d.Status {
	case StatusPublished, StatusDraft, StatusArchived:
	default:
		return fmt.Errorf("%s: unknown status %q", prefix, d.Status)
	}
	if d.Steps == nil {
		return fmt.Errorf("%s: steps is required", prefix)
	}

	for _, c := range d.Connections {
		if c.ID == "" {
			return fmt.Errorf("%s: every connection needs an id", prefix)
		}
	}
	for _, t := range d.Triggers {
		if err := identifier(t.ID, "trigger id", prefix); err != nil {
			return err
		}
		if t.Use == "" {
			return fmt.Errorf("%s: trigger %q needs a use", prefix, t.ID)
		}
	}
	if err := validateVariables(d.Vars, "", prefix); err != nil {
		return err
	}
	for _, b := range d.Blocks {
		if err := identifier(b.ID, "block id", prefix); err != nil {
			return err
		}
		if b.Steps == nil {
			return fmt.Errorf("%s: block %q needs a steps list", prefix, b.ID)
		}
		if err := validateVariables(b.Vars, fmt.Sprintf(" of block %q", b.ID), prefix); err != nil {
			return err
		}
		for _, side := range [][]Declaration{b.Params, b.Outputs} {
			if err := validateDeclarations(side, fmt.Sprintf("block %q", b.ID), prefix); err != nil {
				return err
			}
		}
	}

	var err error
	WalkDocument(*d, func(_ StepRef, s Step) {
		if err != nil {
			return
		}
		if s.ID == "" {
			err = fmt.Errorf("%s: every step needs an id — references point at it", prefix)
			return
		}
		if idErr := identifier(s.ID, "step id", prefix); idErr != nil {
			err = idErr
			return
		}
		if s.Use == "" {
			err = fmt.Errorf("%s: step %q needs a use", prefix, s.ID)
		}
	})
	if err != nil {
		return err
	}

	for _, board := range Boards(*d) {
		if err := validateBranches(board.Steps, prefix); err != nil {
			return err
		}
	}
	return nil
}

// identifierPattern is schemas/workflow-definition.schema.yaml's `identifier`.
//
// Every user-chosen name sits one segment below a reserved root — `steps.<id>`,
// `var.<key>`, `block.<id>` — so a name the expression grammar cannot parse is a
// name nothing can ever address. Refused here rather than accepted into a file
// and reported as a broken Reference on every use of it.
var identifierPattern = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

func identifier(value, what, prefix string) error {
	if value == "" {
		return fmt.Errorf("%s: every %s is required", prefix, what)
	}
	if !identifierPattern.MatchString(value) {
		return fmt.Errorf("%s: %s %q is not an identifier", prefix, what, value)
	}
	return nil
}

// validateType holds a `t` to the set a document may name.
//
// One function rather than a switch per caller, because a block's contract and a
// Board's variables are checked against the same set and a second copy is a
// second answer: a type this accepts and the JSON Schema refuses is a document
// the runner loads and the builder will not open.
//
// `item` is refused along with everything else outside the set. It resolves by
// following a loop's list back to its source output, and neither a parameter nor
// a variable is the output of anything. `unknown` is refused for a sharper
// reason: the checker treats it as matching everything, so accepting it would
// switch the type gate off for that name while the builder still drew a marking
// beside it.
func validateType(t, what, prefix string) error {
	switch t {
	case "text", "number", "boolean", "datetime", "object", "list":
		return nil
	}
	return fmt.Errorf("%s: %s declares an unusable type %q", prefix, what, t)
}

// validateVariables holds a Board's variables to the same contract a block's
// declarations are held to.
//
// A variable's `t` is what every `{{var.<key>}}` read and every `core.set_var`
// write is checked against, so it is the contract rather than a hint, and `of`
// carries the same nested shape a declaration's does.
func validateVariables(vars []Variable, where, prefix string) error {
	for _, v := range vars {
		if err := identifier(v.Key, "var key", prefix); err != nil {
			return err
		}
		owner := fmt.Sprintf("variable %q%s", v.Key, where)
		if err := validateType(v.T, owner, prefix); err != nil {
			return err
		}
		if err := validateDeclarations(v.Of, owner, prefix); err != nil {
			return err
		}
	}
	return nil
}

// validateDeclarations holds a block's contract to the shape a manifest output
// has, and a variable's `of` to the same one.
//
// Deliberately unbounded in depth, because the schema is: a cap here and none in
// the JSON Schema would refuse a document the builder published, which is the
// divergence this function exists to prevent. A bound belongs in the shared
// contract or nowhere.
func validateDeclarations(declarations []Declaration, owner, prefix string) error {
	for _, declaration := range declarations {
		if err := identifier(declaration.K, "declaration key", prefix); err != nil {
			return err
		}
		if declaration.Label == "" {
			return fmt.Errorf("%s: %q in %s needs a label", prefix, declaration.K, owner)
		}
		if err := validateType(
			declaration.T,
			fmt.Sprintf("%q in %s", declaration.K, owner),
			prefix,
		); err != nil {
			return err
		}
		if err := validateDeclarations(declaration.Of, owner, prefix); err != nil {
			return err
		}
	}
	return nil
}

func validateBranches(steps []Step, prefix string) error {
	for _, s := range steps {
		for _, b := range s.Branches {
			if b.Steps == nil {
				return fmt.Errorf("%s: branch %q of step %q needs a steps list", prefix, b.Label, s.ID)
			}
			if err := validateBranches(b.Steps, prefix); err != nil {
				return err
			}
		}
		if err := validateBranches(s.Steps, prefix); err != nil {
			return err
		}
	}
	return nil
}
