import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactNode } from 'react'
import { Button } from '../primitives/Button'
import { Input } from '../primitives/Input'
import { Toggle } from '../primitives/Toggle'
import { createTheme, type ThemeSeed } from './createTheme'
import { type ColorMode, HatuaProvider } from './HatuaProvider'

/**
 * The provider, which had no story until now — an omission worth naming, since
 * theming is the entire reason this component exists and "a Host re-themes by
 * supplying values, never by swapping components" (ADR-0002) was a claim
 * nothing here let you look at.
 *
 * Every story mounts its own provider: `parameters.provider = false` turns off
 * the decorator that normally wraps stories, because a story about the provider
 * cannot live inside one it does not control.
 */
// No `component`: these stories mount their own providers — often several at
// once — rather than being driven by args, and naming one here would make
// HatuaProviderProps' required `children` a required arg on every story.
const meta = {
  title: 'Theme/Theming',
  parameters: { provider: false, layout: 'fullscreen' },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

/** Enough of Hatua to see a theme land: an accent, a surface, a radius, a face. */
function Sampler() {
  return (
    <div style={{ display: 'grid', gap: 12, padding: 20 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Button variant="primary">Publish</Button>
        <Button variant="secondary">Test run</Button>
        <Button variant="ghost">Undo</Button>
        <Button variant="danger">Discard</Button>
      </div>
      <Input aria-label="Workflow name" defaultValue="Nightly digest" />
      <Toggle label="Run on a schedule" checked onCheckedChange={() => {}} />
    </div>
  )
}

function Panel({ title, mode, seed }: { title: string; mode: ColorMode; seed?: ThemeSeed }) {
  return (
    <div style={{ minInlineSize: 0 }}>
      <p
        style={{ margin: 0, padding: '8px 20px 0', font: '600 11px/1.6 system-ui', opacity: 0.55 }}
      >
        {title}
      </p>
      <HatuaProvider colorMode={mode} theme={seed ? createTheme(seed) : undefined}>
        <Sampler />
      </HatuaProvider>
    </div>
  )
}

const Grid = ({ children }: { children: ReactNode }) => (
  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', minBlockSize: '100vh' }}>
    {children}
  </div>
)

/** Hatua's own palette, both modes. The baseline every other story reads against. */
export const DefaultTheme: Story = {
  render: () => (
    <Grid>
      <Panel title="DEFAULT · LIGHT" mode="light" />
      <Panel title="DEFAULT · DARK" mode="dark" />
    </Grid>
  ),
}

/**
 * A Host supplies seeds; every ramp and alias derives from them in CSS. Nothing
 * below was themed component by component — one `createTheme()` call moved the
 * accent, the neutral ramp, the surface, the radius and the type face together.
 */
export const HostBrand: Story = {
  render: () => (
    <Grid>
      <Panel
        title="HOST BRAND · LIGHT"
        mode="light"
        seed={{
          accent: 'oklch(0.55 0.19 25)',
          ink: '#2b1f1a',
          surface: '#fbf7f4',
          radius: 2,
          fontFamily: 'Georgia, "Times New Roman", serif',
        }}
      />
      <Panel
        title="HOST BRAND · DARK"
        mode="dark"
        seed={{
          accent: 'oklch(0.55 0.19 25)',
          ink: '#2b1f1a',
          surface: '#fbf7f4',
          radius: 2,
          fontFamily: 'Georgia, "Times New Roman", serif',
        }}
      />
    </Grid>
  ),
}

/**
 * Two instances, two themes, one page.
 *
 * This is what "scoped to this subtree" means, and it is only true because the
 * seeds are written as inline custom properties on each provider's own element
 * rather than onto `:root`. A library that themed itself globally could render
 * one of these correctly at a time.
 */
export const TwoInstancesAtOnce: Story = {
  render: () => (
    <Grid>
      <Panel title="INSTANCE A · TEAL" mode="light" />
      <Panel
        title="INSTANCE B · VIOLET, ON THE SAME PAGE"
        mode="light"
        seed={{ accent: 'oklch(0.52 0.21 295)', radius: 16 }}
      />
    </Grid>
  ),
}

/**
 * The Host's own CSS, untouched.
 *
 * The frame below sets `--accent`, `--surface-card`, `--radius-md` and
 * `--text-primary` — unprefixed names of its own — and styles its
 * own chrome from them. Hatua is mounted *inside* it, which is the case that
 * matters: custom properties inherit downward, so an unprefixed Hatua alias
 * would have shadowed the Host's for everything in this subtree, and a Host
 * wrapper reading `var(--accent)` would have drawn Hatua's teal instead of its
 * own pink.
 *
 * Both survive because every name Hatua writes is `--hatua-*`. The pink chrome
 * is the Host's; the designer inside it is Hatua's; neither moved.
 */
export const DoesNotTouchHostTokens: Story = {
  render: () => (
    <div
      style={
        {
          '--accent': '#e0218a',
          '--surface-card': '#fff0f7',
          '--radius-md': '999px',
          '--text-primary': '#4a0d2c',
          minBlockSize: '100vh',
          padding: 20,
          background: 'var(--surface-card)',
          font: '13px/1.6 system-ui',
          color: 'var(--text-primary)',
        } as React.CSSProperties
      }
    >
      <p style={{ margin: '0 0 12px' }}>
        Host chrome, drawn from the Host's <code>--accent</code>, <code>--surface-card</code>,{' '}
        <code>--radius-md</code> and <code>--text-primary</code>:
      </p>
      <button
        type="button"
        style={{
          border: 0,
          padding: '8px 16px',
          borderRadius: 'var(--radius-md)',
          background: 'var(--accent)',
          color: '#fff',
          font: 'inherit',
          marginBottom: 20,
        }}
      >
        A Host button
      </button>

      <div style={{ border: '1px dashed var(--accent)', borderRadius: 8 }}>
        <HatuaProvider colorMode="light">
          <Sampler />
        </HatuaProvider>
      </div>
    </div>
  ),
}
