import type { Meta, StoryObj } from '@storybook/react-vite'
import type { CSSProperties, ReactNode } from 'react'

/**
 * The alias vocabulary, rendered from the aliases themselves.
 *
 * This is the sheet to look at when the two colour modes disagree: every swatch
 * is a `var()` reading one alias and nothing else, so a value that reads wrong here is wrong
 * in base.css, not in a component. The seeds are deliberately absent — a
 * component may not reference one (ADR-0002), so there is nothing to review.
 */
const meta = {
  title: 'Foundations/Tokens',
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

const TEXT = [
  '--hatua-text-primary',
  '--hatua-text-secondary',
  '--hatua-text-muted',
  '--hatua-text-accent',
]
const SURFACES = [
  '--hatua-surface-page',
  '--hatua-surface-card',
  '--hatua-surface-sunken',
  '--hatua-surface-raised',
]
const BORDERS = ['--hatua-border-subtle', '--hatua-border-strong', '--hatua-border-accent']
const ACCENTS = [
  '--hatua-accent',
  '--hatua-accent-hover',
  '--hatua-accent-press',
  '--hatua-accent-wash',
]
const STATUS = [
  '--hatua-status-ok',
  '--hatua-status-warn',
  '--hatua-status-error',
  '--hatua-status-error-wash',
]
const RADII = ['--hatua-radius-sm', '--hatua-radius-md', '--hatua-radius-lg']

const Group = ({ name, children }: { name: string; children: ReactNode }) => (
  <section style={{ marginBottom: 24 }}>
    <h3 style={{ margin: '0 0 8px', fontSize: '0.75rem', color: 'var(--hatua-text-muted)' }}>
      {name}
    </h3>
    <div style={{ display: 'grid', gap: 6 }}>{children}</div>
  </section>
)

const Swatch = ({ alias, children }: { alias: string; children?: ReactNode }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.75rem' }}>
    {children}
    <code style={{ color: 'var(--hatua-text-secondary)' }}>{alias}</code>
  </div>
)

const Chip = ({ style }: { style: CSSProperties }) => (
  <span
    style={{
      width: 40,
      height: 24,
      flex: 'none',
      borderRadius: 'var(--hatua-radius-sm)',
      border: '1px solid var(--hatua-border-subtle)',
      ...style,
    }}
  />
)

export const Foundations: Story = {
  render: () => (
    <div style={{ maxWidth: 380 }}>
      <Group name="text">
        {TEXT.map((alias) => (
          <Swatch key={alias} alias={alias}>
            <span style={{ width: 40, color: `var(${alias})`, fontWeight: 600 }}>Aa</span>
          </Swatch>
        ))}
      </Group>
      <Group name="surface">
        {SURFACES.map((alias) => (
          <Swatch key={alias} alias={alias}>
            <Chip style={{ background: `var(${alias})` }} />
          </Swatch>
        ))}
      </Group>
      <Group name="border">
        {BORDERS.map((alias) => (
          <Swatch key={alias} alias={alias}>
            <Chip style={{ borderColor: `var(${alias})`, borderWidth: 2 }} />
          </Swatch>
        ))}
      </Group>
      <Group name="accent">
        {ACCENTS.map((alias) => (
          <Swatch key={alias} alias={alias}>
            <Chip style={{ background: `var(${alias})` }} />
          </Swatch>
        ))}
      </Group>
      <Group name="status">
        {STATUS.map((alias) => (
          <Swatch key={alias} alias={alias}>
            <Chip style={{ background: `var(${alias})` }} />
          </Swatch>
        ))}
      </Group>
      <Group name="radius">
        {RADII.map((alias) => (
          <Swatch key={alias} alias={alias}>
            <Chip
              style={{ background: 'var(--hatua-surface-sunken)', borderRadius: `var(${alias})` }}
            />
          </Swatch>
        ))}
      </Group>
      <Group name="depth">
        <Swatch alias="--hatua-shadow-color">
          <Chip
            style={{
              background: 'var(--hatua-surface-card)',
              boxShadow: '0 6px 16px var(--hatua-shadow-color)',
            }}
          />
        </Swatch>
        <Swatch alias="--hatua-scrim">
          <Chip style={{ background: 'var(--hatua-scrim)' }} />
        </Swatch>
      </Group>
      <Group name="focus">
        <Swatch alias="--hatua-focus-ring">
          <Chip
            style={{
              background: 'var(--hatua-surface-card)',
              boxShadow: '0 0 0 3px var(--hatua-focus-ring)',
            }}
          />
        </Swatch>
      </Group>
    </div>
  ),
}
