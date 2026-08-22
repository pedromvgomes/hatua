package hatua

// Types mirroring schemas/component-manifest.schema.yaml.
//
// There is no connector manifest: connections are established outside the
// builder and arrive from the Host carrying their own type, which a conn field
// matches against via ConnType.

// ManifestKind separates a step type from a trigger type. Both are declared
// identically; a trigger's outputs are the payload it delivers.
type ManifestKind string

const (
	KindComponent ManifestKind = "component"
	KindTrigger   ManifestKind = "trigger"
	// KindContext marks a Run Context Manifest, which is a different file and a
	// different struct — see RunContextManifest. It is named here because the
	// flat array a Host serves carries all three kinds, and a reader deciding
	// what it is holding needs every value the discriminant can take.
	KindContext ManifestKind = "context"
)

// MetadataRole decides how a reported value is aggregated. A measure is
// summable (tokens, cost); a dimension is groupable (model, region). Declaring
// both is what lets "tokens per model" be derived with no runner-supplied
// schema.
type MetadataRole string

const (
	RoleMeasure   MetadataRole = "measure"
	RoleDimension MetadataRole = "dimension"
)

// Manifest declares one component or trigger. Adding one is all it takes for a
// new step type to appear in the library, inspector, reference tree and
// validation — no screen-level code follows.
type Manifest struct {
	Kind  ManifestKind `yaml:"kind"`
	Use   string       `yaml:"use"`
	Name  string       `yaml:"name"`
	Group string       `yaml:"group,omitempty"`
	// Icon is a URL the browser fetches — absolute, root-relative or a data:
	// URI — not a name from an icon set. Hatua ships no set, so a name would be
	// meaningless for a Host declaring a component of its own; the Host serves
	// the artwork the same way it serves the manifest.
	Icon     string       `yaml:"icon,omitempty"`
	Blurb    string       `yaml:"blurb,omitempty"`
	Once     bool         `yaml:"once,omitempty"`
	Fixed    bool         `yaml:"fixed,omitempty"`
	Fields   []Field      `yaml:"fields"`
	Outputs  []Output     `yaml:"outputs"`
	Metadata []Descriptor `yaml:"metadata,omitempty"`
}

// Catalogue is the alternative delivery shape: one file per component suits
// authoring and diffing, a catalogue suits serving.
type Catalogue struct {
	Components []Manifest `yaml:"components"`
}

// RunContextManifest declares the ambient values the Host hands its runner for
// every execution — the run id, the tenant, when the run started. Addressed as
// `run.<k>` from any Expression.
//
// Its own file rather than a fourth Kind inside the Component Manifest: a
// Component Manifest requires Use, Name, Fields and Outputs, none of which a
// Run Context has, and a conditional shape is what schemas/README.md keeps the
// generator away from. There is exactly one per execution, so it declares keys
// directly instead of naming a type someone instantiates — hence no Use, no
// Name and no catalogue wrapper.
//
// Mirrors schemas/context-manifest.schema.yaml.
type RunContextManifest struct {
	Kind ManifestKind `yaml:"kind"`
	Keys []ContextKey `yaml:"keys"`
}

// ContextKey is one ambient value the Host promises to supply.
//
// Spelled {k, label, t, of} exactly as an Output is, because the reference
// tree, the completion list and the type checker read that shape already and a
// second spelling for one idea is a second reader to keep in step. What it adds
// is Description, for the sentence the completion list shows under the row.
//
// There is no `item` in T: item is the for-each escape hatch, resolved by
// following a loop's list back to its source output, and a Run Context key is
// not the output of anything.
type ContextKey struct {
	K           string       `yaml:"k"`
	Label       string       `yaml:"label"`
	T           string       `yaml:"t"`
	Description string       `yaml:"description,omitempty"`
	Of          []ContextKey `yaml:"of,omitempty"`
}

// Field is one configurable input. Label is always required — the key is never
// shown to a user raw.
type Field struct {
	Kind        string        `yaml:"kind"`
	K           string        `yaml:"k"`
	Label       string        `yaml:"label"`
	ConnType    string        `yaml:"conn_type,omitempty"`
	Req         bool          `yaml:"req,omitempty"`
	Hint        string        `yaml:"hint,omitempty"`
	Placeholder string        `yaml:"ph,omitempty"`
	Mono        bool          `yaml:"mono,omitempty"`
	Options     []FieldOption `yaml:"options,omitempty"`
	ToggleLabel string        `yaml:"toggleLabel,omitempty"`
	// EntryTypes narrows which types a `map` field's entries may declare.
	//
	// Absent from this struct, LoadManifests rejected the *whole catalogue* with
	// "field entry_types not found" — because the decoder runs with
	// KnownFields(true) — for a manifest the schema documents as valid. Every
	// key the schema accepts has to exist here.
	EntryTypes []string `yaml:"entry_types,omitempty"`
	When       []string `yaml:"when,omitempty"`
}

// FieldOption is one choice of an enum field.
type FieldOption struct {
	Value string `yaml:"value"`
	Label string `yaml:"label"`
	Hint  string `yaml:"hint,omitempty"`
}

// Output is one value a step produces, addressable as a Reference.
type Output struct {
	K     string   `yaml:"k"`
	Label string   `yaml:"label"`
	T     string   `yaml:"t"`
	Of    []Output `yaml:"of,omitempty"`
}

// Descriptor declares one metadata key this component reports per run.
type Descriptor struct {
	K     string       `yaml:"k"`
	Label string       `yaml:"label"`
	T     string       `yaml:"t"`
	Role  MetadataRole `yaml:"role"`
	Unit  string       `yaml:"unit,omitempty"`
}
