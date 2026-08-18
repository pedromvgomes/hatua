package expressions

// The type lattice, and the one rule that uses it.
//
// The expected type is always known before the expression is looked at: it
// comes from FieldSpec.Kind for a `with:` value, and it is boolean for a
// branch's `when`. Nothing infers a field's type *from* its expression; the
// expression is checked *against* the field.
//
// What varies is whether the expression's own type can be determined
// statically, and that gives three outcomes:
//
//	known, matches     accepted
//	known, conflicts   error — publish blocked
//	unknown            accepted with a warning, checked at run time instead
//
// The middle row is what makes the checker usable. json.parse(s2.output).count
// has no static type, and rejecting it would make the function unusable while
// accepting it silently would hide a real risk.

// TypeNode is the declared shape of something addressable. Members describes an
// object's members, or — for a list — the fields of each element, which is
// exactly what a Component Manifest's `of:` means.
type TypeNode struct {
	Type    ValueType           `yaml:"type"`
	Members map[string]TypeNode `yaml:"members"`
}

// ScopeEntry is one thing an expression may name, and what it yields.
//
// Scope arrives as an argument rather than being derived here, so this package
// depends on the SDK's own types and nothing else.
type ScopeEntry struct {
	// Path is the token root: `s2`, `triggers.nightly`, `var.digest_to`, `TRIGGER`.
	Path string   `yaml:"path"`
	Type TypeNode `yaml:"type"`
}

// TypeVerdict is the outcome of checking an expression's type against a field's.
type TypeVerdict string

const (
	VerdictMatches   TypeVerdict = "matches"
	VerdictConflicts TypeVerdict = "conflicts"
	VerdictUnknown   TypeVerdict = "unknown"
)

// Match compares a statically-determined type against a declared one.
//
// The coercion permitted here is exactly the coercion Satisfies permits at run
// time, stated once at the level of types rather than values.
func Match(actual, declared ValueType) TypeVerdict {
	if actual == TypeUnknown || actual == TypeItem {
		return VerdictUnknown
	}
	if declared == TypeUnknown || declared == TypeItem {
		return VerdictMatches
	}
	if actual == TypeNull || actual == declared {
		return VerdictMatches
	}
	if declared == TypeText && IsScalar(actual) {
		return VerdictMatches
	}
	return VerdictConflicts
}

// CanOrder reports whether a statically-known type could be an operand of an
// ordered comparison.
func CanOrder(t ValueType) bool {
	return t == TypeUnknown || t == TypeItem ||
		t == TypeNumber || t == TypeText || t == TypeDatetime
}

// ElementOf is the element shape of a list, which the manifest spells as the
// list's own `of:`.
func ElementOf(node TypeNode) TypeNode {
	return TypeNode{Type: TypeObject, Members: node.Members}
}
