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
	Kind     ManifestKind `yaml:"kind"`
	Use      string       `yaml:"use"`
	Name     string       `yaml:"name"`
	Group    string       `yaml:"group,omitempty"`
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

// Field is one configurable input. Label is always required — the key is never
// shown to a user raw.
type Field struct {
	Kind        string       `yaml:"kind"`
	K           string       `yaml:"k"`
	Label       string       `yaml:"label"`
	ConnType    string       `yaml:"conn_type,omitempty"`
	Req         bool         `yaml:"req,omitempty"`
	Hint        string       `yaml:"hint,omitempty"`
	Placeholder string       `yaml:"ph,omitempty"`
	Mono        bool         `yaml:"mono,omitempty"`
	Options     []FieldOption `yaml:"options,omitempty"`
	ToggleLabel string       `yaml:"toggleLabel,omitempty"`
	When        []string     `yaml:"when,omitempty"`
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
