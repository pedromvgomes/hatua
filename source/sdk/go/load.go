package hatua

import (
	"fmt"

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

// Validate covers every key the schema marks required. It must reject exactly
// what the TypeScript side rejects: a document Go accepts and zod refuses is a
// workflow that fails in the builder and runs anyway, which is the divergence
// this SDK exists to prevent. conformance/definition/invalid/ pins each case.
//
// Cross-field rules that depend on manifests — connection type matching, empty
// loops, unmapped required fields — belong to the builder's model layer and are
// not duplicated here.
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
		if t.ID == "" {
			return fmt.Errorf("%s: every trigger needs an id", prefix)
		}
		if t.Use == "" {
			return fmt.Errorf("%s: trigger %q needs a use", prefix, t.ID)
		}
	}
	for _, v := range d.Vars {
		if v.Key == "" {
			return fmt.Errorf("%s: every var needs a key", prefix)
		}
	}

	var err error
	WalkSteps(d.Steps, func(s Step) {
		if err != nil {
			return
		}
		if s.ID == "" {
			err = fmt.Errorf("%s: every step needs an id — references point at it", prefix)
			return
		}
		if s.Use == "" {
			err = fmt.Errorf("%s: step %q needs a use", prefix, s.ID)
		}
	})
	if err != nil {
		return err
	}

	return validateBranches(d.Steps, prefix)
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
