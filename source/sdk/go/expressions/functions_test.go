package expressions

import "testing"

// Registry construction, which is not expressible as a template scenario: it
// happens before any expression is evaluated, and it is where a Host's
// functions meet Hatua's.

func TestCoreFunctionsMatchTheDeclaration(t *testing.T) {
	registry := CoreFunctions()
	if len(registry) != len(CoreFunctionSpecs) {
		t.Fatalf("expected %d functions, got %d", len(CoreFunctionSpecs), len(registry))
	}
	for _, spec := range CoreFunctionSpecs {
		if _, ok := registry[spec.Qualified]; !ok {
			t.Fatalf("%s is declared but not registered", spec.Qualified)
		}
	}
}

func TestCoreFunctionsCarryTheirDeclaration(t *testing.T) {
	upper, ok := CoreFunctions()["text.upper"]
	if !ok {
		t.Fatal("text.upper is missing")
	}
	if upper.Spec.Returns != TypeText || len(upper.Spec.Params) != 1 {
		t.Fatalf("unexpected signature: %#v", upper.Spec)
	}
}

func hostRegistry(t *testing.T, qualified string) Registry {
	t.Helper()
	namespace, name := "crm", "owner"
	if qualified == "text.upper" {
		namespace, name = "text", "upper"
	}
	registry, err := HostFunctions(
		[]FunctionSpec{{Namespace: namespace, Name: name, Qualified: qualified, Returns: TypeText}},
		map[string]FunctionImpl{qualified: func(_ []Value, _ Context) Value { return "HOST" }},
	)
	if err != nil {
		t.Fatalf("building the host registry: %v", err)
	}
	return registry
}

func TestMergeRegistriesCombines(t *testing.T) {
	merged, err := MergeRegistries(CoreFunctions(), hostRegistry(t, "crm.owner"))
	if err != nil {
		t.Fatalf("merging: %v", err)
	}
	if _, ok := merged["crm.owner"]; !ok {
		t.Fatal("the host function is missing")
	}
	if _, ok := merged["text.upper"]; !ok {
		t.Fatal("a core function went missing")
	}
}

// A collision is a loud error rather than a silent winner: either answer is a
// workflow that behaves differently depending on which registry was built
// first, and neither is discoverable from the workflow.
func TestMergeRegistriesRefusesACollision(t *testing.T) {
	_, err := MergeRegistries(CoreFunctions(), hostRegistry(t, "text.upper"))
	failure, ok := err.(*Error)
	if !ok || failure.Code() != CodeExprFunctionCollision {
		t.Fatalf("expected EXPR_FUNCTION_COLLISION, got %v", err)
	}
}

func TestHostFunctionsRefusesADeclarationWithNoImplementation(t *testing.T) {
	_, err := HostFunctions(
		[]FunctionSpec{{Namespace: "crm", Name: "owner", Qualified: "crm.owner", Returns: TypeText}},
		map[string]FunctionImpl{},
	)
	if err == nil {
		t.Fatal("expected a declaration with no implementation to be refused")
	}
}
