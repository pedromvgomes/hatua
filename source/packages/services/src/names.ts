import { identifier } from '@hatua/schema'

/**
 * The rule for a name the document addresses something by: a variable's `key`,
 * a declaration's `k`, a Block's `id`, a Step's `id`.
 *
 * From `@hatua/schema`'s `identifier` rather than a regex written again here.
 * The schema is the contract (ADR-0006), and a second spelling of a rule is a
 * second answer to it the day one of them changes.
 *
 * **Every command that writes one checks it.** A name the schema cannot hold
 * makes the whole document stop projecting, and every surface in the product
 * reads the projection — so one committed keystroke empties the canvas, the
 * side panel and the step editor together, and leaves the user nothing to click
 * on to get back. `EditingStore.apply` refuses that outcome generically; this is
 * what lets a command refuse it *by name*, which is a thing a field can report.
 */
export const isUsableName = (name: string): boolean => identifier.safeParse(name).success

/** Throws unless `name` is one the document can address something by. */
export function requireUsableName(name: string): void {
  if (!isUsableName(name)) throw new Error(`"${name}" is not a usable name`)
}
