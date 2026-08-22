/**
 * The Hatua SDK for Node backends and workflow runners.
 *
 * This exists mainly so no Host has to reimplement the expression language. A
 * runner that evaluates `{{ … }}` differently from the builder produces the
 * worst possible failure: a workflow that looks correct in the editor and does
 * the wrong thing in production. One evaluator, shared, removes that.
 *
 * It re-exports the contract rather than duplicating it, so a runner validates
 * with exactly the code the builder validated with — and the same is now true
 * of evaluation: `@hatua/expressions` is the one implementation, and
 * `hatua.dev/go/expressions` is its Go counterpart, kept honest by
 * conformance/expression/.
 */

export {
  type CheckContext,
  coreFunctions,
  type Diagnostic,
  type DiagnosticCode,
  type EvaluationContext,
  ExpressionError,
  type FunctionImpl,
  type FunctionRegistry,
  hostFunctions,
  isReference,
  mergeRegistries,
  type OnMissing,
  parseTemplate,
  resolve,
  resolveAll,
  type ScopeEntry,
  type Severity,
  type Slot,
  sourceReference,
  type TypeNode,
  type Value,
  type ValueType,
  validate,
} from '@hatua/expressions'
export {
  boardScope,
  findStep,
  scopeFor,
  slotsFor,
  upstreamOf,
  walkSteps,
  whenSlot,
} from '@hatua/model'
export * from '@hatua/schema'
export { loadDefinition, loadExecution, loadManifests, loadRunContext } from './load'
