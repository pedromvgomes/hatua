import type { ComponentPropsWithRef } from 'react'
import { cx } from '../primitives/classNames'
import styles from './Library.module.css'
import css from './Library.module.css?inline'
import { Placeholder } from './Placeholder'

export type LibraryProps = ComponentPropsWithRef<'section'>

/**
 * The Library tab: the Components a Host's Component Manifests declare, ready
 * to be added to the Workflow Definition as Steps.
 *
 * A stub until the library PR. Hatua never invents a Component, so everything
 * this region will ever show arrives from the Host through a port — which is
 * why it is a region and not a block.
 */
export function Library({ className, ...rest }: LibraryProps) {
  return (
    <>
      <style href="hatua-library" precedence="hatua">
        {css}
      </style>
      <section aria-label="Library" className={cx(styles.library, className)} {...rest}>
        <Placeholder>
          The Components the Host declares land here, grouped and searchable.
        </Placeholder>
      </section>
    </>
  )
}
