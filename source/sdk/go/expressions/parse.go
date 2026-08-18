package expressions

// The generated parser, wrapped.
//
// The grammar covers the whole Template, not just the expression: scannerless
// PEG treats the `{{` / `}}` boundary as an ordinary rule, so segmentation is
// generated in both languages rather than being a hand-written scanner on each
// side — which would be a divergence surface sitting in front of the parser.
//
// There is no escape rule either. `{{ '{{' }}` is not special-cased anywhere:
// it is a hole containing a text literal, and it falls out of the grammar.

// ParseTemplate parses a whole Template.
func ParseTemplate(source string) (*Template, error) {
	parsed, err := Parse("template", []byte(source), Entrypoint("Template"))
	if err != nil {
		return nil, parseFailure(err)
	}
	return parsed.(*Template), nil
}

// ParseExpression parses one Expression, with no surrounding `{{ }}`.
//
// Only the conformance corpus and tooling need this; a field value is always a
// whole Template. It exists because precedence and associativity bugs are
// *parse* bugs, and they are invisible to evaluation scenarios whenever two
// parsers build different trees that happen to evaluate alike on the sample
// data — the most dangerous divergence there is, because it passes everything
// until one workflow hits the disagreeing case.
func ParseExpression(source string) (Expression, error) {
	parsed, err := Parse("expression", []byte(source), Entrypoint("Expr"))
	if err != nil {
		return nil, parseFailure(err)
	}
	return parsed.(Expression), nil
}

func parseFailure(err error) *Error {
	return newError(NewDiagnostic(CodeExprParseError, parseOffset(err), map[string]string{
		"detail": err.Error(),
	}))
}

// parseOffset digs the offset out of pigeon's error list. Reaching into the
// generated parser's own types is only possible because it is generated into
// this package — and pigeon is pinned to one version for exactly this kind of
// reason.
func parseOffset(err error) int {
	errs, ok := err.(errList)
	if !ok || len(errs) == 0 {
		return 0
	}
	if parseErr, ok := errs[0].(*parserError); ok {
		return parseErr.pos.offset
	}
	return 0
}
