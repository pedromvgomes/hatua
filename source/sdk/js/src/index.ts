/**
 * The Hatua SDK for Node backends and workflow runners.
 *
 * This exists mainly so no Host has to reimplement the expression language. A
 * runner that evaluates `{{ … }}` differently from the builder produces the
 * worst possible failure: a workflow that looks correct in the editor and does
 * the wrong thing in production. One evaluator, shared, removes that.
 *
 * It re-exports the contract rather than duplicating it, so a runner validates
 * with exactly the code the builder validated with.
 */

export { findStep, scopeFor, upstreamOf, walkSteps } from '@hatua/model'
export * from '@hatua/schema'
export { type EvaluationContext, evaluate } from './expression'
export { loadDefinition, loadExecution, loadManifests } from './load'
