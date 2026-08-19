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

const TEXT = ['--text-primary', '--text-secondary', '--text-muted', '--text-accent']
const SURFACES = ['--surface-page', '--surface-card', '--surface-sunken', '--surface-raised']
const BORDERS = ['--border-subtle', '--border-strong', '--border-accent']
const ACCENTS = ['--accent', '--accent-hover', '--accent-press', '--accent-wash']
const STATUS = ['--status-ok', '--status-warn', '--status-error', '--status-error-wash']
const RADII = ['--radius-sm', '--radius-md', '--radius-lg']

const Group = ({ name, children }: { name: string; children: ReactNode }) => (
  <section style={{ marginBottom: 24 }}>
    <h3 style={{ margin: '0 0 8px', fontSize: '0.75rem', color: 'var(--text-muted)' }}>{name}</h3>
    <div style={{ display: 'grid', gap: 6 }}>{children}</div>
  </section>
)

const Swatch = ({ alias, children }: { alias: string; children?: ReactNode }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.75rem' }}>
    {children}
    <code style={{ color: 'var(--text-secondary)' }}>{alias}</code>
  </div>
)

const Chip = ({ style }: { style: CSSProperties }) => (
  <span
    style={{
      width: 40,
      height: 24,
      flex: 'none',
      borderRadius: 'var(--radius-sm)',
      border: '1px solid var(--border-subtle)',
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
            <Chip style={{ background: 'var(--surface-sunken)', borderRadius: `var(${alias})` }} />
          </Swatch>
        ))}
      </Group>
      <Group name="depth">
        <Swatch alias="--shadow-color">
          <Chip
            style={{
              background: 'var(--surface-card)',
              boxShadow: '0 6px 16px var(--shadow-color)',
            }}
          />
        </Swatch>
        <Swatch alias="--scrim">
          <Chip style={{ background: 'var(--scrim)' }} />
        </Swatch>
      </Group>
      <Group name="focus">
        <Swatch alias="--focus-ring">
          <Chip
            style={{ background: 'var(--surface-card)', boxShadow: '0 0 0 3px var(--focus-ring)' }}
          />
        </Swatch>
      </Group>
    </div>
  ),
}
