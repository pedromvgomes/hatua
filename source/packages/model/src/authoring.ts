import type { Step } from '@hatua/schema'
import { FOR_EACH_VERB, FORK_VERB } from './slots'
import { REPEAT_VERB, TRY_VERB } from './tree'

/**
 * What the verb decides about a Step that does not exist yet.
 *
 * `regionsOf` reads the keys and never the verb, and that is load-bearing: a
 * `handler:` on a `core.fork` is meaningless and has no runner, but refusing to
 * draw it would make it undeletable rather than absent (`docs/handoff.md` §
 * Flow map geometry). That rule answers "what does this Step nest". It cannot
 * answer "what should a new one nest", because a Step written with neither key
 * nests nothing at all — and the verb is the only thing that knows a `core.try`
 * protects a body and falls back to a handler.
 *
 * The two questions are asked by different callers at different moments, which
 * is why they are two functions and this one sits downstream of both the region
 * vocabulary and the verbs.
 */

/**
 * The regions a Step of this verb is born carrying.
 *
 * Empty and present, never populated. An empty region is a Band on the map with
 * a word over it and an insert point inside — `banded` in @hatua/layout draws
 * one for exactly that reason — and that is the whole of what makes it somewhere
 * a Step can be dropped. Without the key there is no region, so there is no
 * frame, no `+`, and no way to put anything inside the container: a card that
 * can never be filled in.
 *
 * `TRY_HAS_NO_BODY` and `LOOP_HAS_NO_BODY` still report against the result. That
 * is the point — the Step is unfinished, and these are the frames it gets
 * finished in.
 *
 * `core.fork` is the one verb whose regions are not empty lists, because a
 * Branch carries a label and a condition of its own. It is still born with two
 * of them: CONTEXT.md defines a Fork as holding two or more, one Branch is the
 * same path with a condition on it, and a Fork with none is a card with nothing
 * inside it and no way to put anything there.
 *
 * Two, and a **condition** fork rather than a parallel one — `when: ''` on the
 * first Branch is a condition nobody has written yet, and its absence on the
 * second is what makes that one the fallback. A parallel fork is the shape that
 * cannot be reached by editing one field, so the reachable shape is the one to
 * be born in.
 *
 * The labels are rendered copy and reach an end user's screen, so they are
 * written in the words on the screen rather than in this repository's
 * (`.agents/rules/rendered-copy-is-written-for-the-hosts-users.md`).
 */
export function bornRegionsOf(use: string): Pick<Step, 'steps' | 'handler' | 'branches'> {
  if (use === TRY_VERB) return { steps: [], handler: [] }
  if (use === FOR_EACH_VERB || use === REPEAT_VERB) return { steps: [] }
  if (use === FORK_VERB) {
    return {
      branches: [
        { label: 'Condition', when: '', steps: [] },
        { label: 'Otherwise', steps: [] },
      ],
    }
  }
  return {}
}
