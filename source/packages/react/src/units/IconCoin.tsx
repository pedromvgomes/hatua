import type { Manifest } from '@hatua/schema'
import { useState } from 'react'
import styles from './IconCoin.module.css'
import css from './IconCoin.module.css?inline'

export interface IconCoinProps {
  /** The Component's manifest, when the Host serves one for this verb. */
  manifest?: Manifest
}

/**
 * The Component's icon, as the Host serves it, in a fixed square.
 *
 * `icon` is a URL, not a name. Hatua ships no icon set and should not: a name is
 * only meaningful against a set, and a Host declaring a component of its own
 * would have nothing to name — which is how this field spent a release resolving
 * to nothing and the card drawing the component's initial instead. A letter is
 * not an icon; it carries no more than the name already beside it.
 *
 * Into a fixed box, `object-fit: contain`, so a Host's artwork cannot decide the
 * height of whatever it sits in however it is proportioned. That matters twice
 * over on the canvas, where the card's height is `LAYOUT.nodeHeight` and a tall
 * icon would overflow it rather than stretch it.
 *
 * `referrerPolicy` because the URL may be a third party's CDN and the Host's own
 * URL can carry a workflow id. `alt=""` because the name is beside it: this is
 * decoration, and announcing it twice helps nobody.
 */
export function IconCoin({ manifest }: IconCoinProps) {
  // The URL that failed, not a boolean, so the flag cannot outlive the URL it
  // was about. A catalogue arriving with a fixed icon on the same component
  // would otherwise keep drawing the placeholder for the life of the mount.
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const icon = typeof manifest?.icon === 'string' ? manifest.icon : undefined
  const broken = failedUrl !== null && failedUrl === icon

  return (
    <>
      <style href="hatua-icon-coin" precedence="hatua">
        {css}
      </style>
      <span className={styles.coin}>
        {!icon || broken ? (
          // A URL that 404s is the Host's to fix, and until it does this still
          // has to draw something square. Deliberately neutral rather than a
          // guess at what the icon would have been.
          //
          // No <title>: decoration inside an aria-hidden element, so a title
          // would be announced to nobody and shown as a tooltip to everybody.
          <svg
            className={styles.placeholder}
            viewBox="0 0 16 16"
            focusable="false"
            aria-hidden="true"
          >
            <rect x="2.5" y="2.5" width="11" height="11" rx="3" />
          </svg>
        ) : (
          <img
            className={styles.image}
            src={icon}
            alt=""
            width={18}
            height={18}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onError={() => setFailedUrl(icon)}
          />
        )}
      </span>
    </>
  )
}
