import type { ComponentPropsWithRef } from 'react'
import { cx } from '../primitives/classNames'
import { Placeholder } from './Placeholder'
import styles from './TopBar.module.css'
import css from './TopBar.module.css?inline'

export type TopBarProps = ComponentPropsWithRef<'section'>

/**
 * The toolbar: the workflow's name, the Draft/Published state, and the actions
 * that change it — Publish, Discard Draft, Text Mode.
 *
 * A stub until the toolbar PR. What is settled here is the boundary: a Host
 * mounts this alone, above whatever it likes, and it carries no knowledge of
 * the regions beside it.
 *
 * Deliberately not a <header> and deliberately not an <h1>. A <header> with no
 * sectioning ancestor IS the page's banner, and Hatua is a guest — the Host
 * embedding the designer already has a banner and already has an <h1> naming
 * its own product, so both would be claimed twice and the workflow's name would
 * outrank the application containing it. The name is a label here; which
 * heading level it deserves is the Host's outline to decide, and the toolbar PR
 * can offer one if a Host asks.
 */
export function TopBar({ className, ...rest }: TopBarProps) {
  return (
    <>
      <style href="hatua-topbar" precedence="hatua">
        {css}
      </style>
      <section aria-label="Toolbar" className={cx(styles.topBar, className)} {...rest}>
        <p className={styles.title}>Untitled workflow</p>
        <Placeholder>The workflow name, its version state and its actions land here.</Placeholder>
      </section>
    </>
  )
}
