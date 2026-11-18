package runner

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
	"sync"
	"testing"
)

// handlerNamed returns a Handler whose output identifies it, so a test can
// tell which of several registrations a lookup returned.
func handlerNamed(name string) Handler {
	return func(context.Context, map[string]any) (map[string]any, error) {
		return map[string]any{"handler": name}, nil
	}
}

func callName(t *testing.T, h Handler) string {
	t.Helper()
	out, err := h(context.Background(), nil)
	if err != nil {
		t.Fatalf("handler returned error: %v", err)
	}
	name, _ := out["handler"].(string)
	return name
}

type registration struct {
	verb    string
	handler Handler
}

func TestRegister(t *testing.T) {
	tests := []struct {
		name    string
		setup   []registration
		verb    string
		handler Handler
		wantErr error
		// wantHandler is the name of the Handler Lookup(verb) returns after
		// the registration, whether or not it succeeded; empty means the verb
		// stays unregistered.
		wantHandler string
	}{
		{
			name:        "registers a verb",
			verb:        "http.request",
			handler:     handlerNamed("first"),
			wantHandler: "first",
		},
		{
			name:        "registers beside other verbs",
			setup:       []registration{{"log", handlerNamed("log")}},
			verb:        "http.request",
			handler:     handlerNamed("first"),
			wantHandler: "first",
		},
		{
			name:        "rejects a duplicate verb and keeps the first handler",
			setup:       []registration{{"http.request", handlerNamed("first")}},
			verb:        "http.request",
			handler:     handlerNamed("second"),
			wantErr:     ErrDuplicateVerb,
			wantHandler: "first",
		},
		{
			name:    "rejects an empty verb",
			verb:    "",
			handler: handlerNamed("first"),
			wantErr: ErrEmptyVerb,
		},
		{
			name:    "rejects a nil handler",
			verb:    "http.request",
			handler: nil,
			wantErr: ErrNilHandler,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := NewRegistry()
			for _, s := range tt.setup {
				if err := r.Register(s.verb, s.handler); err != nil {
					t.Fatalf("setup Register(%q): %v", s.verb, err)
				}
			}

			err := r.Register(tt.verb, tt.handler)
			if !errors.Is(err, tt.wantErr) {
				t.Fatalf("Register(%q) error = %v, want %v", tt.verb, err, tt.wantErr)
			}
			if tt.wantErr != nil {
				var ve *VerbError
				if !errors.As(err, &ve) {
					t.Fatalf("Register(%q) error %T is not a *VerbError", tt.verb, err)
				}
				if ve.Verb != tt.verb {
					t.Errorf("VerbError.Verb = %q, want %q", ve.Verb, tt.verb)
				}
				if !strings.Contains(err.Error(), fmt.Sprintf("%q", tt.verb)) {
					t.Errorf("error %q does not name verb %q", err, tt.verb)
				}
			}

			h, lerr := r.Lookup(tt.verb)
			if tt.wantHandler == "" {
				if !errors.Is(lerr, ErrUnregisteredVerb) {
					t.Fatalf("Lookup(%q) error = %v, want ErrUnregisteredVerb", tt.verb, lerr)
				}
				return
			}
			if lerr != nil {
				t.Fatalf("Lookup(%q): %v", tt.verb, lerr)
			}
			if got := callName(t, h); got != tt.wantHandler {
				t.Errorf("Lookup(%q) returned handler %q, want %q", tt.verb, got, tt.wantHandler)
			}
		})
	}
}

func TestLookup(t *testing.T) {
	tests := []struct {
		name        string
		registry    func() *Registry
		verb        string
		wantHandler string
		wantErr     error
	}{
		{
			name: "finds a registered verb",
			registry: func() *Registry {
				r := NewRegistry()
				_ = r.Register("log", handlerNamed("log"))
				_ = r.Register("http.request", handlerNamed("http"))
				return r
			},
			verb:        "http.request",
			wantHandler: "http",
		},
		{
			name: "reports an unregistered verb",
			registry: func() *Registry {
				r := NewRegistry()
				_ = r.Register("log", handlerNamed("log"))
				return r
			},
			verb:    "http.request",
			wantErr: ErrUnregisteredVerb,
		},
		{
			name:     "reports any verb on the zero Registry",
			registry: func() *Registry { return &Registry{} },
			verb:     "log",
			wantErr:  ErrUnregisteredVerb,
		},
		{
			name:     "reports the empty verb as unregistered",
			registry: NewRegistry,
			verb:     "",
			wantErr:  ErrUnregisteredVerb,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h, err := tt.registry().Lookup(tt.verb)
			if !errors.Is(err, tt.wantErr) {
				t.Fatalf("Lookup(%q) error = %v, want %v", tt.verb, err, tt.wantErr)
			}
			if tt.wantErr != nil {
				if h != nil {
					t.Errorf("Lookup(%q) returned a handler alongside an error", tt.verb)
				}
				var ve *VerbError
				if !errors.As(err, &ve) || ve.Verb != tt.verb {
					t.Errorf("Lookup(%q) error %v does not carry the verb", tt.verb, err)
				}
				return
			}
			if got := callName(t, h); got != tt.wantHandler {
				t.Errorf("Lookup(%q) returned handler %q, want %q", tt.verb, got, tt.wantHandler)
			}
		})
	}
}

func TestVerbs(t *testing.T) {
	tests := []struct {
		name     string
		register []string
		want     []string
	}{
		{name: "empty registry", register: nil, want: []string{}},
		{name: "single verb", register: []string{"log"}, want: []string{"log"}},
		{
			name:     "sorted regardless of registration order",
			register: []string{"wait", "http.request", "log", "branch"},
			want:     []string{"branch", "http.request", "log", "wait"},
		},
		{
			name:     "rejected registrations are absent",
			register: []string{"log", "", "log"},
			want:     []string{"log"},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := NewRegistry()
			for _, verb := range tt.register {
				_ = r.Register(verb, handlerNamed(verb))
			}
			got := r.Verbs()
			if got == nil || !slices.Equal(got, tt.want) {
				t.Errorf("Verbs() = %#v, want %#v", got, tt.want)
			}
		})
	}
}

func TestVerbsReturnsACallerOwnedSlice(t *testing.T) {
	r := NewRegistry()
	_ = r.Register("a", handlerNamed("a"))
	_ = r.Register("b", handlerNamed("b"))

	got := r.Verbs()
	got[0] = "mutated"

	if again := r.Verbs(); !slices.Equal(again, []string{"a", "b"}) {
		t.Errorf("Verbs() after mutating an earlier result = %v, want [a b]", again)
	}
}

// TestRegistryConcurrentUse is meaningful under -race: it fails there if
// Lookup, Verbs and Register touch the map without synchronisation.
func TestRegistryConcurrentUse(t *testing.T) {
	r := NewRegistry()
	const verbs = 16
	for i := range verbs {
		verb := fmt.Sprintf("verb.%02d", i)
		if err := r.Register(verb, handlerNamed(verb)); err != nil {
			t.Fatalf("Register(%q): %v", verb, err)
		}
	}

	var wg sync.WaitGroup
	errs := make(chan error, 64*(verbs+1)+8)
	for g := range 64 {
		wg.Go(func() {
			for i := range verbs {
				verb := fmt.Sprintf("verb.%02d", (g+i)%verbs)
				h, err := r.Lookup(verb)
				if err != nil {
					errs <- err
					continue
				}
				out, err := h(context.Background(), nil)
				if err != nil || out["handler"] != verb {
					errs <- fmt.Errorf("Lookup(%q) returned the wrong handler: %v %v", verb, out, err)
				}
			}
			if len(r.Verbs()) < verbs {
				errs <- errors.New("Verbs() lost a registration")
			}
		})
	}
	for i := range 8 {
		wg.Go(func() {
			verb := fmt.Sprintf("late.%d", i)
			if err := r.Register(verb, handlerNamed(verb)); err != nil {
				errs <- err
			}
		})
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Error(err)
	}
	if got := len(r.Verbs()); got != verbs+8 {
		t.Errorf("len(Verbs()) = %d, want %d", got, verbs+8)
	}
}
