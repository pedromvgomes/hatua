package runner

import (
	"context"
	"errors"
	"math"
	"reflect"
	"strings"
	"testing"
)

type nodeMode string

type nodeLeaf struct {
	Name  string `hatua:"name"`
	Count int    `hatua:"count"`
}

type nodeInput struct {
	Str     string            `hatua:"str"`
	Bool    bool              `hatua:"bool"`
	Int     int               `hatua:"int"`
	Int8    int8              `hatua:"int8"`
	Uint    uint              `hatua:"uint"`
	Uint8   uint8             `hatua:"uint8"`
	Float   float64           `hatua:"float"`
	Float32 float32           `hatua:"float32"`
	Mode    nodeMode          `hatua:"mode"`
	Strs    []string          `hatua:"strs"`
	Leaves  []nodeLeaf        `hatua:"leaves"`
	Labels  map[string]string `hatua:"labels"`
	Leaf    nodeLeaf          `hatua:"leaf"`
	Ptr     *nodeLeaf         `hatua:"ptr"`
	IntPtr  *int              `hatua:"intPtr"`
	Any     any               `hatua:"any"`
	Err     error             `hatua:"err"`
	Untag   string
	Skipped string `hatua:"-"`
	hidden  string
}

func intPtr(n int) *int { return &n }

func decodeInput(t *testing.T, fields map[string]any) (nodeInput, error) {
	t.Helper()
	var got nodeInput
	n := Node[nodeInput, map[string]any](func(_ context.Context, in nodeInput) (map[string]any, error) {
		got = in
		return nil, nil
	})
	h, err := n.Handler()
	if err != nil {
		t.Fatalf("Handler() error = %v", err)
	}
	_, err = h(context.Background(), fields)
	return got, err
}

func TestNodeDecodes(t *testing.T) {
	tests := []struct {
		name   string
		fields map[string]any
		want   nodeInput
	}{
		{name: "nil fields leave every field zero", fields: nil, want: nodeInput{}},
		{name: "absent field stays zero", fields: map[string]any{"str": "x"}, want: nodeInput{Str: "x"}},
		{name: "nil value stays zero", fields: map[string]any{"str": nil, "strs": nil}, want: nodeInput{}},
		{name: "unknown field is ignored", fields: map[string]any{"nope": 1, "str": "x"}, want: nodeInput{Str: "x"}},
		{name: "string", fields: map[string]any{"str": "hello"}, want: nodeInput{Str: "hello"}},
		{name: "bool", fields: map[string]any{"bool": true}, want: nodeInput{Bool: true}},
		{name: "int from int", fields: map[string]any{"int": 7}, want: nodeInput{Int: 7}},
		{name: "int from whole float64", fields: map[string]any{"int": float64(7)}, want: nodeInput{Int: 7}},
		{name: "int from int64", fields: map[string]any{"int": int64(-3)}, want: nodeInput{Int: -3}},
		{name: "int8 from float at its limit", fields: map[string]any{"int8": float64(-128)}, want: nodeInput{Int8: -128}},
		{name: "uint from int", fields: map[string]any{"uint": 9}, want: nodeInput{Uint: 9}},
		{name: "uint8 from float", fields: map[string]any{"uint8": float64(255)}, want: nodeInput{Uint8: 255}},
		{name: "float from float64", fields: map[string]any{"float": 2.5}, want: nodeInput{Float: 2.5}},
		{name: "float from int", fields: map[string]any{"float": 4}, want: nodeInput{Float: 4}},
		{name: "float32 from float64", fields: map[string]any{"float32": 1.5}, want: nodeInput{Float32: 1.5}},
		{name: "named string from string", fields: map[string]any{"mode": "fast"}, want: nodeInput{Mode: "fast"}},
		{name: "slice from []any", fields: map[string]any{"strs": []any{"a", "b"}}, want: nodeInput{Strs: []string{"a", "b"}}},
		{name: "slice from typed slice", fields: map[string]any{"strs": []string{"a"}}, want: nodeInput{Strs: []string{"a"}}},
		{name: "empty slice stays non-nil", fields: map[string]any{"strs": []any{}}, want: nodeInput{Strs: []string{}}},
		{
			name:   "slice of structs",
			fields: map[string]any{"leaves": []any{map[string]any{"name": "a", "count": 1.0}, map[string]any{"name": "b"}}},
			want:   nodeInput{Leaves: []nodeLeaf{{Name: "a", Count: 1}, {Name: "b"}}},
		},
		{
			name:   "map",
			fields: map[string]any{"labels": map[string]any{"env": "prod"}},
			want:   nodeInput{Labels: map[string]string{"env": "prod"}},
		},
		{
			name:   "nested struct",
			fields: map[string]any{"leaf": map[string]any{"name": "n", "count": 2, "extra": true}},
			want:   nodeInput{Leaf: nodeLeaf{Name: "n", Count: 2}},
		},
		{
			name:   "nested struct of the declared type is stored as is",
			fields: map[string]any{"leaf": nodeLeaf{Name: "n"}},
			want:   nodeInput{Leaf: nodeLeaf{Name: "n"}},
		},
		{
			name:   "pointer to struct",
			fields: map[string]any{"ptr": map[string]any{"name": "p"}},
			want:   nodeInput{Ptr: &nodeLeaf{Name: "p"}},
		},
		{name: "pointer to int", fields: map[string]any{"intPtr": 5.0}, want: nodeInput{IntPtr: intPtr(5)}},
		{name: "absent pointer stays nil", fields: map[string]any{}, want: nodeInput{}},
		{
			name:   "any takes the value as it is",
			fields: map[string]any{"any": map[string]any{"k": []any{1, "two"}}},
			want:   nodeInput{Any: map[string]any{"k": []any{1, "two"}}},
		},
		{name: "interface takes a value implementing it", fields: map[string]any{"err": errors.New("boom")}, want: nodeInput{Err: errors.New("boom")}},
		{name: "untagged field matches its lower-camel name", fields: map[string]any{"untag": "u"}, want: nodeInput{Untag: "u"}},
		{name: "untagged field ignores its Go name", fields: map[string]any{"Untag": "u"}, want: nodeInput{}},
		{name: "hatua:\"-\" field is skipped", fields: map[string]any{"Skipped": "s", "skipped": "s", "-": "s"}, want: nodeInput{}},
		{name: "unexported field is skipped", fields: map[string]any{"hidden": "h"}, want: nodeInput{}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := decodeInput(t, tt.fields)
			if err != nil {
				t.Fatalf("decode error = %v", err)
			}
			// errors.New values never compare equal, so compare the message.
			if (got.Err == nil) != (tt.want.Err == nil) || (got.Err != nil && got.Err.Error() != tt.want.Err.Error()) {
				t.Fatalf("Err = %v, want %v", got.Err, tt.want.Err)
			}
			got.Err, tt.want.Err = nil, nil
			if !reflect.DeepEqual(got, tt.want) {
				t.Fatalf("decoded\n got %+v\nwant %+v", got, tt.want)
			}
		})
	}
}

func TestNodeDecodeErrorNamesTheField(t *testing.T) {
	tests := []struct {
		name      string
		fields    map[string]any
		wantField string
		wantErr   error
	}{
		{name: "string given a number", fields: map[string]any{"str": 1}, wantField: "str", wantErr: ErrFieldType},
		{name: "bool given a string", fields: map[string]any{"bool": "true"}, wantField: "bool", wantErr: ErrFieldType},
		{name: "int given a string", fields: map[string]any{"int": "7"}, wantField: "int", wantErr: ErrFieldType},
		{name: "int given a fraction", fields: map[string]any{"int": 2.5}, wantField: "int", wantErr: ErrFieldRange},
		{name: "int given NaN", fields: map[string]any{"int": math.NaN()}, wantField: "int", wantErr: ErrFieldRange},
		{name: "int given infinity", fields: map[string]any{"int": math.Inf(1)}, wantField: "int", wantErr: ErrFieldRange},
		{name: "int given a float beyond int64", fields: map[string]any{"int": 1e19}, wantField: "int", wantErr: ErrFieldRange},
		{name: "int given a uint beyond int64", fields: map[string]any{"int": uint64(math.MaxUint64)}, wantField: "int", wantErr: ErrFieldRange},
		{name: "int8 overflow", fields: map[string]any{"int8": 128}, wantField: "int8", wantErr: ErrFieldRange},
		{name: "uint given a negative int", fields: map[string]any{"uint": -1}, wantField: "uint", wantErr: ErrFieldRange},
		{name: "uint given a negative float", fields: map[string]any{"uint": -1.0}, wantField: "uint", wantErr: ErrFieldRange},
		{name: "uint given a fraction", fields: map[string]any{"uint": 0.5}, wantField: "uint", wantErr: ErrFieldRange},
		{name: "uint8 overflow", fields: map[string]any{"uint8": 256.0}, wantField: "uint8", wantErr: ErrFieldRange},
		{name: "float32 overflow", fields: map[string]any{"float32": 1e300}, wantField: "float32", wantErr: ErrFieldRange},
		{name: "float given a bool", fields: map[string]any{"float": true}, wantField: "float", wantErr: ErrFieldType},
		{name: "slice given a string", fields: map[string]any{"strs": "a"}, wantField: "strs", wantErr: ErrFieldType},
		{name: "slice element", fields: map[string]any{"strs": []any{"a", "b", 3}}, wantField: "strs[2]", wantErr: ErrFieldType},
		{
			name:      "field of a struct in a slice",
			fields:    map[string]any{"leaves": []any{map[string]any{}, map[string]any{}, map[string]any{"count": "x"}}},
			wantField: "leaves[2].count",
			wantErr:   ErrFieldType,
		},
		{name: "map given a slice", fields: map[string]any{"labels": []any{}}, wantField: "labels", wantErr: ErrFieldType},
		{name: "map entry", fields: map[string]any{"labels": map[string]any{"env": 1}}, wantField: `labels["env"]`, wantErr: ErrFieldType},
		{name: "struct given a string", fields: map[string]any{"leaf": "x"}, wantField: "leaf", wantErr: ErrFieldType},
		{name: "nested struct field", fields: map[string]any{"leaf": map[string]any{"count": 1.5}}, wantField: "leaf.count", wantErr: ErrFieldRange},
		{name: "through a pointer", fields: map[string]any{"ptr": map[string]any{"name": false}}, wantField: "ptr.name", wantErr: ErrFieldType},
		{name: "interface not implemented", fields: map[string]any{"err": "boom"}, wantField: "err", wantErr: ErrFieldType},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := decodeInput(t, tt.fields)
			var fe *FieldError
			if !errors.As(err, &fe) {
				t.Fatalf("error = %v, want a *FieldError", err)
			}
			if fe.Field != tt.wantField {
				t.Fatalf("Field = %q, want %q", fe.Field, tt.wantField)
			}
			if !errors.Is(err, tt.wantErr) {
				t.Fatalf("error = %v, want it to wrap %v", err, tt.wantErr)
			}
			if !strings.Contains(err.Error(), tt.wantField) {
				t.Fatalf("message %q does not name the field %q", err.Error(), tt.wantField)
			}
		})
	}
}

func TestNodeMapInputPassesThrough(t *testing.T) {
	fields := map[string]any{"a": 1, "b": []any{"x"}}
	var got map[string]any
	n := Node[map[string]any, map[string]any](func(_ context.Context, in map[string]any) (map[string]any, error) {
		got = in
		return nil, nil
	})
	h, err := n.Handler()
	if err != nil {
		t.Fatalf("Handler() error = %v", err)
	}
	if _, err := h(context.Background(), fields); err != nil {
		t.Fatalf("handler error = %v", err)
	}
	if !reflect.DeepEqual(got, fields) {
		t.Fatalf("input = %v, want %v", got, fields)
	}
}

type nodeOutput struct {
	ID      string            `hatua:"id"`
	Count   int               `hatua:"count"`
	Mode    nodeMode          `hatua:"mode"`
	Ratio   float32           `hatua:"ratio"`
	OK      bool              `hatua:"ok"`
	Leaf    nodeLeaf          `hatua:"leaf"`
	Leaves  []nodeLeaf        `hatua:"leaves"`
	Labels  map[string]string `hatua:"labels"`
	Ptr     *nodeLeaf         `hatua:"ptr"`
	Any     any               `hatua:"any"`
	Untag   int
	Skipped string `hatua:"-"`
}

func encodeOutput[Out any](t *testing.T, out Out) (map[string]any, error) {
	t.Helper()
	n := Node[map[string]any, Out](func(context.Context, map[string]any) (Out, error) {
		return out, nil
	})
	h, err := n.Handler()
	if err != nil {
		t.Fatalf("Handler() error = %v", err)
	}
	return h(context.Background(), nil)
}

func TestNodeEncodesStructOutput(t *testing.T) {
	tests := []struct {
		name string
		out  nodeOutput
		want map[string]any
	}{
		{
			name: "zero values are included",
			out:  nodeOutput{},
			want: map[string]any{
				"id": "", "count": 0, "mode": "", "ratio": float32(0), "ok": false,
				"leaf":   map[string]any{"name": "", "count": 0},
				"leaves": nil, "labels": nil, "ptr": nil, "any": nil, "untag": 0,
			},
		},
		{
			name: "every kind",
			out: nodeOutput{
				ID: "a", Count: 3, Mode: "fast", Ratio: 0.5, OK: true,
				Leaf:    nodeLeaf{Name: "l", Count: 1},
				Leaves:  []nodeLeaf{{Name: "x"}},
				Labels:  map[string]string{"env": "prod"},
				Ptr:     &nodeLeaf{Name: "p", Count: 2},
				Any:     []nodeLeaf{{Name: "y"}},
				Untag:   9,
				Skipped: "never",
			},
			want: map[string]any{
				"id": "a", "count": 3, "mode": "fast", "ratio": float32(0.5), "ok": true,
				"leaf":   map[string]any{"name": "l", "count": 1},
				"leaves": []any{map[string]any{"name": "x", "count": 0}},
				"labels": map[string]any{"env": "prod"},
				"ptr":    map[string]any{"name": "p", "count": 2},
				"any":    []any{map[string]any{"name": "y", "count": 0}},
				"untag":  9,
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := encodeOutput(t, tt.out)
			if err != nil {
				t.Fatalf("encode error = %v", err)
			}
			if !reflect.DeepEqual(got, tt.want) {
				t.Fatalf("encoded\n got %#v\nwant %#v", got, tt.want)
			}
		})
	}
}

func TestNodeMapOutputPassesThrough(t *testing.T) {
	want := map[string]any{"k": []any{1}}
	got, err := encodeOutput(t, want)
	if err != nil {
		t.Fatalf("encode error = %v", err)
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("output = %v, want %v", got, want)
	}
}

func TestNodeEncodeErrorNamesTheField(t *testing.T) {
	_, err := encodeOutput(t, nodeOutput{Any: map[string]any{"bad": []any{make(chan int)}}})
	var fe *FieldError
	if !errors.As(err, &fe) {
		t.Fatalf("error = %v, want a *FieldError", err)
	}
	if want := `any["bad"][0]`; fe.Field != want {
		t.Fatalf("Field = %q, want %q", fe.Field, want)
	}
	if !errors.Is(err, ErrFieldType) {
		t.Fatalf("error = %v, want it to wrap ErrFieldType", err)
	}
}

func TestNodeHandlerRejectsUnsupportedTypes(t *testing.T) {
	type withChan struct{ C chan int }
	type withArray struct{ A [2]int }
	type withIntKeys struct{ M map[int]string }
	type deepFunc struct{ L []struct{ F func() } }
	type dupKeys struct {
		A string `hatua:"x"`
		B string `hatua:"x"`
	}
	type recursive struct {
		Name     string
		Children []recursive
	}
	nop := func(context.Context, map[string]any) (map[string]any, error) { return nil, nil }
	tests := []struct {
		name    string
		handler func() (Handler, error)
		wantErr error
	}{
		{"input is a string", Node[string, map[string]any](func(context.Context, string) (map[string]any, error) { return nil, nil }).Handler, ErrInputType},
		{"input is a pointer to struct", Node[*nodeLeaf, map[string]any](func(context.Context, *nodeLeaf) (map[string]any, error) { return nil, nil }).Handler, ErrInputType},
		{"input is a map of strings", Node[map[string]string, map[string]any](func(context.Context, map[string]string) (map[string]any, error) { return nil, nil }).Handler, ErrInputType},
		{"input holds a channel", Node[withChan, map[string]any](func(context.Context, withChan) (map[string]any, error) { return nil, nil }).Handler, ErrInputType},
		{"input holds an array", Node[withArray, map[string]any](func(context.Context, withArray) (map[string]any, error) { return nil, nil }).Handler, ErrInputType},
		{"input holds a map with int keys", Node[withIntKeys, map[string]any](func(context.Context, withIntKeys) (map[string]any, error) { return nil, nil }).Handler, ErrInputType},
		{"input holds a func deep inside", Node[deepFunc, map[string]any](func(context.Context, deepFunc) (map[string]any, error) { return nil, nil }).Handler, ErrInputType},
		{"input has duplicate keys", Node[dupKeys, map[string]any](func(context.Context, dupKeys) (map[string]any, error) { return nil, nil }).Handler, ErrInputType},
		{"output is a string", Node[map[string]any, string](func(context.Context, map[string]any) (string, error) { return "", nil }).Handler, ErrOutputType},
		{"output is a slice", Node[map[string]any, []any](func(context.Context, map[string]any) ([]any, error) { return nil, nil }).Handler, ErrOutputType},
		{"output is any", Node[map[string]any, any](func(context.Context, map[string]any) (any, error) { return nil, nil }).Handler, ErrOutputType},
		{"output holds a channel", Node[map[string]any, withChan](func(context.Context, map[string]any) (withChan, error) { return withChan{}, nil }).Handler, ErrOutputType},
		{"nil node", Node[map[string]any, map[string]any](nil).Handler, ErrNilHandler},
		{"recursive struct is accepted", Node[recursive, recursive](func(_ context.Context, in recursive) (recursive, error) { return in, nil }).Handler, nil},
		{"map in and out is accepted", Node[map[string]any, map[string]any](nop).Handler, nil},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h, err := tt.handler()
			if tt.wantErr == nil {
				if err != nil || h == nil {
					t.Fatalf("Handler() = %v, %v; want a Handler", h, err)
				}
				return
			}
			if !errors.Is(err, tt.wantErr) {
				t.Fatalf("Handler() error = %v, want %v", err, tt.wantErr)
			}
			if h != nil {
				t.Fatal("Handler() returned a Handler alongside its error")
			}
		})
	}
}

func TestNodeRecursiveStructRoundTrips(t *testing.T) {
	type tree struct {
		Name     string
		Children []tree
	}
	n := Node[tree, tree](func(_ context.Context, in tree) (tree, error) { return in, nil })
	h, err := n.Handler()
	if err != nil {
		t.Fatalf("Handler() error = %v", err)
	}
	fields := map[string]any{"name": "root", "children": []any{map[string]any{"name": "leaf"}}}
	got, err := h(context.Background(), fields)
	if err != nil {
		t.Fatalf("handler error = %v", err)
	}
	want := map[string]any{"name": "root", "children": []any{map[string]any{"name": "leaf", "children": nil}}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("output = %#v, want %#v", got, want)
	}
}

func TestNodeReturnsItsOwnErrorUnchanged(t *testing.T) {
	boom := errors.New("boom")
	n := Node[nodeLeaf, nodeLeaf](func(context.Context, nodeLeaf) (nodeLeaf, error) { return nodeLeaf{}, boom })
	h, err := n.Handler()
	if err != nil {
		t.Fatalf("Handler() error = %v", err)
	}
	out, err := h(context.Background(), nil)
	if err != boom || out != nil {
		t.Fatalf("handler = %v, %v; want nil, %v", out, err, boom)
	}
}

func TestNodePassesContextThrough(t *testing.T) {
	type key struct{}
	ctx := context.WithValue(context.Background(), key{}, "v")
	n := Node[map[string]any, map[string]any](func(ctx context.Context, _ map[string]any) (map[string]any, error) {
		return map[string]any{"v": ctx.Value(key{})}, nil
	})
	h, err := n.Handler()
	if err != nil {
		t.Fatalf("Handler() error = %v", err)
	}
	out, err := h(ctx, nil)
	if err != nil || out["v"] != "v" {
		t.Fatalf("handler = %v, %v; want the context's value", out, err)
	}
}

func TestRegisterNode(t *testing.T) {
	type request struct {
		URL     string            `hatua:"url"`
		Headers map[string]string `hatua:"headers"`
		Retries *int              `hatua:"retries"`
	}
	type response struct {
		Status int    `hatua:"status"`
		Body   string `hatua:"body"`
	}
	r := NewRegistry()
	err := RegisterNode(r, "http.request", Node[request, response](func(_ context.Context, in request) (response, error) {
		if in.Retries != nil {
			return response{}, errors.New("retries should be absent")
		}
		return response{Status: 200, Body: in.URL + " " + in.Headers["accept"]}, nil
	}))
	if err != nil {
		t.Fatalf("RegisterNode error = %v", err)
	}
	h, err := r.Lookup("http.request")
	if err != nil {
		t.Fatalf("Lookup error = %v", err)
	}

	out, err := h(context.Background(), map[string]any{
		"url":     "https://example.test",
		"headers": map[string]any{"accept": "text/plain"},
	})
	if err != nil {
		t.Fatalf("handler error = %v", err)
	}
	want := map[string]any{"status": 200, "body": "https://example.test text/plain"}
	if !reflect.DeepEqual(out, want) {
		t.Fatalf("output = %v, want %v", out, want)
	}

	_, err = h(context.Background(), map[string]any{"headers": map[string]any{"accept": 1}})
	var fe *FieldError
	if !errors.As(err, &fe) || fe.Field != `headers["accept"]` {
		t.Fatalf("error = %v, want a *FieldError naming headers[\"accept\"]", err)
	}
}

func TestRegisterNodeErrors(t *testing.T) {
	nop := Node[map[string]any, map[string]any](func(context.Context, map[string]any) (map[string]any, error) { return nil, nil })
	tests := []struct {
		name     string
		setup    bool
		verb     string
		register func(*Registry, string) error
		wantErr  error
	}{
		{
			name: "unsupported output names the verb",
			verb: "bad",
			register: func(r *Registry, verb string) error {
				return RegisterNode(r, verb, Node[map[string]any, int](func(context.Context, map[string]any) (int, error) { return 0, nil }))
			},
			wantErr: ErrOutputType,
		},
		{
			name: "nil node names the verb",
			verb: "nil",
			register: func(r *Registry, verb string) error {
				return RegisterNode(r, verb, Node[map[string]any, map[string]any](nil))
			},
			wantErr: ErrNilHandler,
		},
		{
			name:     "empty verb",
			verb:     "",
			register: func(r *Registry, verb string) error { return RegisterNode(r, verb, nop) },
			wantErr:  ErrEmptyVerb,
		},
		{
			name:     "duplicate verb",
			setup:    true,
			verb:     "dup",
			register: func(r *Registry, verb string) error { return RegisterNode(r, verb, nop) },
			wantErr:  ErrDuplicateVerb,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := NewRegistry()
			if tt.setup {
				if err := RegisterNode(r, tt.verb, nop); err != nil {
					t.Fatalf("setup RegisterNode error = %v", err)
				}
			}
			err := tt.register(r, tt.verb)
			var ve *VerbError
			if !errors.As(err, &ve) || ve.Verb != tt.verb {
				t.Fatalf("error = %v, want a *VerbError for %q", err, tt.verb)
			}
			if !errors.Is(err, tt.wantErr) {
				t.Fatalf("error = %v, want %v", err, tt.wantErr)
			}
			if !tt.setup {
				if verbs := r.Verbs(); len(verbs) != 0 {
					t.Fatalf("Verbs() = %v, want none registered", verbs)
				}
			}
		})
	}
}
