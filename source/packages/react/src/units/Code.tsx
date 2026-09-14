import type { ComponentPropsWithRef } from 'react'
import { cx } from '../primitives/classNames'
import styles from './Code.module.css'
import css from './Code.module.css?inline'

/**
 * Source text, coloured.
 *
 * Props in, events out — this unit is handed tokens and renders them, and it
 * decides nothing about what a token IS. Two surfaces feed it and they arrive at
 * their tokens completely differently: **Text Mode** lexes YAML text, and the run
 * pane walks a JavaScript value while serialising it. Both end here so a string
 * looks like a string on either screen, which is the whole reason this is one
 * component rather than two blocks of markup.
 *
 * ## What it does not do
 *
 * No line numbers, no gutter, no folding, no scrolling of its own. It renders a
 * `<pre>` and the caller decides how big the box is — because one of the two
 * callers is putting this *under a textarea*, where any chrome of its own would
 * be chrome the caret does not know about.
 */
export interface CodeProps extends Omit<ComponentPropsWithRef<'pre'>, 'children'> {
  tokens: readonly CodeToken[]
}

/**
 * One run of text and what it is.
 *
 * Deliberately not "and where it is". Offsets are how a *producer* works — the
 * YAML lexer hands them back so a Template inside a scalar can be cut finer —
 * and by the time anything reaches here the cutting is done. A token carrying
 * both would be two representations of one string, and the renderer would be
 * where they could disagree.
 */
export interface CodeToken {
  text: string
  kind: CodeKind
}

export type CodeKind =
  | 'key'
  | 'string'
  | 'number'
  | 'comment'
  | 'punctuation'
  /** A `{{ … }}` **Reference**, which no YAML or JSON grammar knows about. */
  | 'reference'
  /** Everything else: plain scalars, whitespace, text a producer could not name. */
  | 'plain'

export function Code({ tokens, className, ...rest }: CodeProps) {
  return (
    <>
      <style href="hatua-code" precedence="hatua">
        {css}
      </style>
      <pre className={cx(styles.code, className)} {...rest}>
        {tokens.map((token, index) => {
          // Plain runs carry no span at all. A `<span class="plain">` around
          // every gap between two coloured tokens triples the node count of a
          // long document for a class that sets nothing.
          if (token.kind === 'plain') return token.text
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: position is the identity
            <span key={index} className={styles[token.kind]}>
              {token.text}
            </span>
          )
        })}
      </pre>
    </>
  )
}
