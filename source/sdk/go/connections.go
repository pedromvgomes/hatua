package hatua

import "strings"

// Connection rules. Two families, and they fail at different moments on purpose.
//
// The mirror of packages/model/src/connections.ts, and the only rules in either
// language whose answer is not in the Workflow Definition. A connection stores an
// opaque ref and nothing else (ADR-0007), so what type it is comes from the Host
// — which makes absence a third answer these rules have to hold, distinct from
// "matches" and "does not match". ADR-0022 is why that answer is silence.

// ConnectionTypes is what the Host says each established connection is, keyed by
// the opaque ref a Workflow Definition stores.
//
// Known is a field rather than "ByRef is nil" because the two facts are
// different and the difference decides whether a document can be published. An
// empty map with Known set is a Host that has established no connections, and a
// ref it does not hold genuinely no longer resolves. Known false is nobody able
// to say — a runner holding no connection state at all — and reporting the same
// thing there would call every connection in the workflow revoked, refusing
// publish to a workflow with nothing wrong with it.
type ConnectionTypes struct {
	// Known says whether the Host answered. False leaves CONNECTION_UNRESOLVABLE
	// and CONNECTION_TYPE_MISMATCH unreported; every other rule still runs.
	Known bool
	// ByRef maps an opaque handle to the type the Host reports for it.
	ByRef map[string]string
}

// established says whether a connection points at anything.
//
// Empty is not established, and not merely nil: the schema types ref as a string
// or null with no minLength, so `ref: ""` parses, and a handle of no characters
// resolves to nothing anywhere. Shared by both rules below because they must
// agree — and because the TypeScript mirror's guard is a truthiness test, so a
// nil-only check here reports CONNECTION_UNRESOLVABLE for a document TypeScript
// says nothing about, which is exactly the divergence the corpus exists to
// catch.
func established(ref *string) bool {
	return ref != nil && strings.TrimSpace(*ref) != ""
}

// UnresolvedConnections reports a connection with no ref, which was never
// established. That blocks publish but not editing — a whole workflow may be
// laid out before its connections are wired, and forcing the connection first
// would make a builder unusable in a fresh environment.
//
// Answered from the document alone, so it is reported whether or not anything
// can describe a connection.
func UnresolvedConnections(doc Definition) []Diagnostic {
	out := []Diagnostic{}
	for _, connection := range doc.Connections {
		if established(connection.Ref) {
			continue
		}
		out = append(out, raise(
			CodeConnectionNotEstablished,
			Diagnostic{ConnectionID: connection.ID},
			map[string]string{"name": connection.ID},
		))
	}
	return out
}

// MismatchedConnections reports a conn field holding a connection it cannot
// hold: one the document does not declare, one whose handle the Host lists
// nothing for, or one whose type is not the field's conn_type — so a "send
// email" step is never handed an LLM connection.
//
// types.Known false reports only what the document answers on its own. Reporting
// the other two anyway would say "no longer resolves" about every connection
// before the Host had spoken, which refuses publish to a workflow with nothing
// wrong with it.
func MismatchedConnections(
	doc Definition,
	byUse map[string]Manifest,
	types ConnectionTypes,
) []Diagnostic {
	declared := make(map[string]Connection, len(doc.Connections))
	for _, connection := range doc.Connections {
		declared[connection.ID] = connection
	}

	out := []Diagnostic{}
	check := func(subject Diagnostic, use string, values map[string]any) {
		manifest, held := byUse[use]
		if !held {
			return
		}
		for _, field := range manifest.Fields {
			if field.Kind != "conn" {
				continue
			}
			id, ok := values[field.K].(string)
			if !ok {
				continue
			}

			// Copied per field, never mutated in place: `subject` is reused by
			// every field on this step, and a raise that forgot to set one of
			// these would carry the previous field's connection and key. The
			// TypeScript mirror spreads a fresh object per raise for the same
			// reason.
			on := subject
			on.FieldKey = field.K
			on.ConnectionID = id

			connection, found := declared[id]
			if !found {
				// A name, not a type: this is wrong whatever the Host says, and a
				// field declaring no conn_type still cannot hold a connection
				// that does not exist.
				out = append(out, raise(CodeConnectionUnknown, on, map[string]string{"name": id}))
				continue
			}
			// An unestablished connection has no type yet; that is reported
			// separately. Nothing to match against, and a field accepting any
			// type has nothing to be wrong about.
			if !established(connection.Ref) || !types.Known || field.ConnType == "" {
				continue
			}

			actual, resolves := types.ByRef[*connection.Ref]
			if !resolves || actual == "" {
				// The Host no longer recognises this handle — revoked, deleted,
				// or pointing at another environment. Silence here would look
				// identical to a matching type.
				out = append(out, raise(
					CodeConnectionUnresolvable,
					on,
					map[string]string{"name": connection.ID},
				))
				continue
			}
			if actual != field.ConnType {
				out = append(out, raise(CodeConnectionTypeMismatch, on, map[string]string{
					"label":  field.Label,
					"wanted": field.ConnType,
					"name":   connection.ID,
					"actual": actual,
				}))
			}
		}
	}

	// Every Board, not doc.Steps: a conn field inside a block is a conn field,
	// and one of the codes above blocks editing — so skipping a Board would lock
	// a document over a step nothing reported.
	WalkDocument(doc, func(ref StepRef, step Step) {
		check(Diagnostic{StepID: step.ID, BlockID: ref.Board}, step.Use, step.With)
	})

	for _, trigger := range doc.Triggers {
		check(Diagnostic{TriggerID: trigger.ID}, trigger.Use, trigger.With)
	}

	return out
}
