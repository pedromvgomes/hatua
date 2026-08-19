import type { ComponentPropsWithRef } from 'react'
import { cx } from '../primitives/classNames'
import { Placeholder } from './Placeholder'
import styles from './TopBar.module.css'
import css from './TopBar.module.css?inline'

export type TopBarProps = ComponentPropsWithRef<'header'>

/**
 * The toolbar: the workflow's name, the Draft/Published state, and the actions
 * that change it — Publish, Discard Draft, Text Mode.
 *
 * A stub until the toolbar PR. What is settled here is the boundary: a Host
 * mounts this alone, above whatever it likes, and it carries no knowledge of
 * the regions beside it.
 */
export function TopBar({ className, ...rest }: TopBarProps) {
  return (
    <>
      <style href="hatua-topbar" precedence="hatua">
        {css}
      </style>
      <header className={cx(styles.topBar, className)} {...rest}>
        <h1 className={styles.title}>Untitled workflow</h1>
        <Placeholder>The workflow name, its version state and its actions land here.</Placeholder>
      </header>
    </>
  )
}
