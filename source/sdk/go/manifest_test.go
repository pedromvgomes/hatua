package hatua

import "testing"

// LoadManifests decodes with KnownFields(true), so any key the schema accepts
// and this package's structs do not rejects the *whole catalogue file* — not
// just the manifest carrying it. A Host narrowing a map field's entry types is
// writing exactly what component-manifest.schema.yaml documents, and it used to
// fail with "field entry_types not found in type hatua.Field".
func TestLoadManifestsAcceptsEveryDocumentedFieldKey(t *testing.T) {
	manifests, err := LoadManifests([]byte(`
components:
  - kind: component
    use: data.map
    name: Map values
    fields:
      - k: entries
        label: Entries
        kind: map
        req: true
        hint: What the next step receives.
        ph: key
        entry_types: [text, number]
        when: [mode, advanced]
    outputs: []
`))
	if err != nil {
		t.Fatalf("loading: %v", err)
	}
	if len(manifests) != 1 {
		t.Fatalf("expected one manifest, got %d", len(manifests))
	}

	field := manifests[0].Fields[0]
	if len(field.EntryTypes) != 2 || field.EntryTypes[0] != "text" {
		t.Fatalf("entry_types did not round-trip: %#v", field.EntryTypes)
	}
}
