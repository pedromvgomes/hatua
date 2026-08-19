import styles from './Placeholder.module.css'
import css from './Placeholder.module.css?inline'

export interface PlaceholderProps {
  /** What lands here, in the vocabulary of the region that owns it. */
  children: string
}

/**
 * The body a region renders until the PR that fills it arrives.
 *
 * Internal: never exported from the package. A region's own file, its props and
 * its stylesheet are the boundary later PRs write against; this is only the
 * text sitting inside it, and the PR that fills a region deletes its use of
 * this and nothing else.
 */
export function Placeholder({ children }: PlaceholderProps) {
  return (
    <>
      <style href="hatua-placeholder" precedence="hatua">
        {css}
      </style>
      <p className={styles.placeholder}>{children}</p>
    </>
  )
}
