import type { Manifest } from '@hatua/schema'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { IconCoin } from './IconCoin'

/**
 * The Component's icon, as the Host serves it, in a fixed square.
 *
 * `icon` is a URL and not a name: Hatua ships no icon set, so a name would have
 * nothing to mean against — which is how this field once resolved to nothing and
 * the card drew the component's initial instead. A letter is not an icon.
 */
const manifest = (icon?: string): Manifest => ({
  kind: 'component',
  use: 'component.email.send',
  name: 'Send email',
  ...(icon ? { icon } : {}),
  fields: [],
  outputs: [],
})

const meta = {
  title: 'Units/IconCoin',
  component: IconCoin,
} satisfies Meta<typeof IconCoin>

export default meta
type Story = StoryObj<typeof meta>

export const Served: Story = { args: { manifest: manifest('/icons/mail.svg') } }

/** A manifest declaring no icon. Neutral, rather than a guess at what it would be. */
export const Undeclared: Story = { args: { manifest: manifest() } }

/** A URL that 404s is the Host's to fix; until it does, this still draws a square. */
export const Broken: Story = { args: { manifest: manifest('/icons/does-not-exist.svg') } }

/** No manifest at all — a verb the Host's catalogue does not declare. */
export const NoManifest: Story = {}
