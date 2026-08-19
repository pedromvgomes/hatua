package expressions

import "unicode/utf16"

// Offsets are UTF-16 code units, in both languages.
//
// This is the one place the two parsers were guaranteed to disagree and the
// corpus could not see it. pigeon reports `c.pos.offset`, a *byte* offset into
// the input; Peggy reports `offset()`, an index into a JavaScript string, which
// is counted in UTF-16 code units. For `héllo {{ a }}` that is 10 against 9, and
// the gap widens with every non-ASCII byte — so a builder's squiggle and a
// runner's log pointed at different characters, silently.
//
// UTF-16 wins because the builder is the primary consumer of an offset and that
// is what indexes a JavaScript string. It costs TypeScript nothing and costs Go
// one pass over the source, only when the source is not pure ASCII.
//
// conformance/expression/parse/offsets.yaml pins it. That file used to be
// entirely ASCII, which is exactly why it never caught this.

// offsetTableKey is where the byte -> UTF-16 table lives in the parser's store.
const offsetTableKey = "hatua.offsets"

// offsetOf is called by the `At` rule the epilogue supplies.
func offsetOf(c *current) (any, error) {
	table, ok := c.globalStore[offsetTableKey].([]int)
	// No table means the source is pure ASCII, where the two units coincide.
	if !ok {
		return c.pos.offset, nil
	}
	if c.pos.offset >= len(table) {
		return table[len(table)-1], nil
	}
	return table[c.pos.offset], nil
}

// offsetTable maps every byte position in source to its UTF-16 code-unit
// position, or returns nil when the source is pure ASCII and the two coincide.
func offsetTable(source string) []int {
	ascii := true
	for i := 0; i < len(source); i++ {
		if source[i] >= 0x80 {
			ascii = false
			break
		}
	}
	if ascii {
		return nil
	}

	table := make([]int, len(source)+1)
	units := 0
	for byteIndex, r := range source {
		start := units
		table[byteIndex] = start
		// Fill the continuation bytes so an offset landing mid-rune — which the
		// grammar never produces, but a future rule might — still resolves, and
		// resolves to the rune it is *inside* rather than to the one after it.
		for fill := byteIndex + 1; fill < len(source) && source[fill]&0xC0 == 0x80; fill++ {
			table[fill] = start
		}
		// Everything above the basic multilingual plane is a surrogate pair,
		// which JavaScript counts as two.
		units += utf16.RuneLen(r)
	}
	table[len(source)] = units
	return table
}
