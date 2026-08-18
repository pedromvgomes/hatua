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
func LoadManifests(data []byte) ([]Manifest, error) {
	var catalogue Catalogue
	if err := decode(data, &catalogue, "Component Manifest"); err == nil && len(catalogue.Components) > 0 {
		return catalogue.Components, nil
	}
	var single Manifest
	if err := decode(data, &single, "Component Manifest"); err != nil {
		return nil, err
	}
	return []Manifest{single}, nil
}

// Validate covers the rules the schema expresses. Cross-field rules that depend
// on manifests — connection type matching, empty loops, unmapped required
// fields — belong to the builder's model layer and are pinned by the shared
// conformance corpus rather than duplicated here.
func (d *Definition) Validate() error {
	if d.ID == "" {
		return fmt.Errorf("not a valid Workflow Definition: id is required")
	}
	if d.Version < 1 {
		return fmt.Errorf("not a valid Workflow Definition: version must be at least 1, got %d", d.Version)
	}
	switch d.Status {
	case StatusPublished, StatusDraft, StatusArchived:
	default:
		return fmt.Errorf("not a valid Workflow Definition: unknown status %q", d.Status)
	}

	var err error
	WalkSteps(d.Steps, func(s Step) {
		if err == nil && s.ID == "" {
			err = fmt.Errorf("not a valid Workflow Definition: every step needs an id — references point at it")
		}
	})
	return err
}
