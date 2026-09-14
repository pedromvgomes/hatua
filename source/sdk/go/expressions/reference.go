package expressions

// A Reference is an AST shape, not a syntax.
//
// There is no `expr:` sigil and no marker of any kind: what makes a Reference
// special is that it names a value and nothing more, which is exactly what lets
// the builder draw it as a pill the user can retarget. `{{ steps.s2.count }}` is a
// Reference; `{{ steps.s2.count + 1 }}` is the same language and is not.

// IsReference reports whether an expression is exactly a path.
//
// Indexing with a literal counts: `s2.messages[0].subject` still names one value
// and nothing more. A call does not — the moment something is computed, there is
// no target to retarget.
func IsReference(node Expression) bool {
	switch n := node.(type) {
	case *Name:
		return true
	case *Member:
		return IsReference(n.Object)
	case *Project:
		return IsReference(n.Object)
	case *Index:
		if _, literal := n.Index.(*Literal); !literal {
			return false
		}
		return IsReference(n.Object)
	}
	return false
}

// ReferencePath is the path a Reference names, or "" when it is not one.
func ReferencePath(node Expression) string {
	if !IsReference(node) {
		return ""
	}
	return PathText(node)
}

// TemplateReference is the Reference a whole Template holds, when it holds
// exactly one and nothing else — the case the builder renders as a pill.
//
// `Hi {{ steps.s2.name }}` is not one: it is text with a hole in it, and the pill
// belongs inside the field rather than instead of it.
func TemplateReference(template *Template) string {
	single := singleHole(template)
	if single == nil {
		return ""
	}
	return ReferencePath(single)
}

// SourceReference is the same, from source, for callers that have not parsed
// anything yet.
func SourceReference(template string) string {
	parsed, err := ParseTemplate(template)
	if err != nil {
		return ""
	}
	return TemplateReference(parsed)
}
