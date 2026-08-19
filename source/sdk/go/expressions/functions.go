package expressions

// Registries are built by explicit construction, never by package-level
// registration in init().
//
// The TypeScript half has a bundling reason for this — import-for-effect makes
// `sideEffects: false` a lie and retains every built-in in a Host's bundle —
// and Go has a plainer one: a registry assembled by init() cannot be assembled
// twice, so a test cannot build one without the Host's functions in it.

// CoreFunctions returns Hatua's own functions, checked against the declaration.
//
// The check is the point of the shared YAML: each language supplies
// implementations only, and verifies its registry against the declaration at
// load time. A function implemented here and not declared — or declared and not
// implemented — is a divergence between the two runtimes waiting to happen, and
// it fails here rather than at a call site in production.
func CoreFunctions() Registry {
	implementations := map[string]FunctionImpl{}
	for _, group := range []map[string]FunctionImpl{
		dtFunctions(),
		textFunctions(),
		numFunctions(),
		listFunctions(),
		jsonFunctions(),
	} {
		for name, impl := range group {
			implementations[name] = impl
		}
	}

	registry := Registry{}
	var missingNames []string

	for _, spec := range CoreFunctionSpecs {
		impl, ok := implementations[spec.Qualified]
		if !ok {
			missingNames = append(missingNames, spec.Qualified)
			continue
		}
		registry[spec.Qualified] = RegisteredFunction{Spec: spec, Impl: impl}
	}

	var undeclared []string
	for name := range implementations {
		if _, ok := registry[name]; !ok {
			undeclared = append(undeclared, name)
		}
	}

	if len(missingNames) > 0 || len(undeclared) > 0 {
		panic(registryMismatch(missingNames, undeclared))
	}
	return registry
}

// MergeRegistries merges a Host's functions into Hatua's.
//
// A collision is a loud error rather than a silent winner. Either answer —
// Hatua wins, or the Host wins — is a workflow that behaves differently
// depending on which registry was built first, and neither is discoverable from
// the workflow itself.
func MergeRegistries(registries ...Registry) (Registry, error) {
	merged := Registry{}
	for _, registry := range registries {
		for name, entry := range registry {
			if _, clash := merged[name]; clash {
				return nil, fail(CodeExprFunctionCollision, 0, map[string]string{"name": name})
			}
			merged[name] = entry
		}
	}
	return merged, nil
}

// HostFunctions builds a registry from Host-declared signatures and their
// implementations.
func HostFunctions(specs []FunctionSpec, implementations map[string]FunctionImpl) (Registry, error) {
	registry := Registry{}
	for _, spec := range specs {
		impl, ok := implementations[spec.Qualified]
		if !ok {
			return nil, fail(CodeEvalUnknownFunction, 0, map[string]string{"name": spec.Qualified})
		}
		registry[spec.Qualified] = RegisteredFunction{Spec: spec, Impl: impl}
	}
	return registry, nil
}

// badArgument reports a well-typed argument that is nonetheless unusable.
func badArgument(name, param, actual string) *Error {
	return fail(CodeEvalBadArgument, 0, map[string]string{
		"name": name, "param": param, "actual": actual,
	})
}

func registryMismatch(missingNames, undeclared []string) string {
	message := "the function registry disagrees with schemas/functions/*.yaml:"
	for _, name := range missingNames {
		message += "\n  declared but not implemented: " + name
	}
	for _, name := range undeclared {
		message += "\n  implemented but not declared: " + name
	}
	return message
}
