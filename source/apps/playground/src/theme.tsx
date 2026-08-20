import { createTheme, Hatua, HatuaProvider, Library } from '@hatua/react'
import type { ReactNode } from 'react'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { SOURCES } from './catalogue'
import { createMemoryWorkflowStore } from './workflow-store'

// The Host imports no CSS — Hatua renders its own stylesheet (ADR-0003).

/**
 * Themes, and the Host's CSS, served at /theme.html.
 *
 * Two claims this page exists to make true rather than assert:
 *
 *  1. **A Host re-themes by supplying values.** Three instances below run three
 *     themes at once, from one `createTheme()` call each. No component was
 *     styled per-instance and no stylesheet was swapped (ADR-0002).
 *  2. **Hatua does not touch the Host's own tokens.** theme.html declares
 *     `--accent`, `--surface-card`, `--radius-md`, `--text-primary` and friends
 *     on `:root`, in the Host's own unprefixed names, and paints this page's
 *     chrome from them. Custom properties inherit downward, so those names
 *     reach *into* Hatua's subtree. Every one of Hatua's is `--hatua-*`, so
 *     nothing collides in either direction: the chrome stays pink, and the
 *     designers stay themselves.
 *
 * The second is the one worth having a page for. It is invisible in a unit test
 * — jsdom does not resolve `var()` through a cascade — and invisible in the
 * other three entries, because none of them declares a token of its own. Break
 * the namespacing and this page goes pink from the top down.
 */
const THEMES = [
  {
    name: "Hatua's own",
    note: 'No theme prop at all — the defaults.',
    theme: undefined,
    // One store each, not one shared between the three. They would otherwise
    // be three sessions editing one document with one claim between them,
    // which is a page about leases rather than about themes.
    workflows: createMemoryWorkflowStore(),
  },
  {
    name: 'A Host with a warm brand',
    note: 'accent, ink, surface, a 2px radius and a serif face, from one createTheme().',
    theme: createTheme({
      accent: 'oklch(0.55 0.19 25)',
      ink: '#2b1f1a',
      surface: '#fbf7f4',
      radius: 2,
      fontFamily: 'Georgia, "Times New Roman", serif',
    }),
    workflows: createMemoryWorkflowStore(),
  },
  {
    name: 'A Host with a cool one',
    note: 'The same components again. Nothing here is styled per instance.',
    theme: createTheme({ accent: 'oklch(0.52 0.21 295)', ink: '#1b1f3b', radius: 16 }),
    workflows: createMemoryWorkflowStore(),
  },
]

function Frame({ title, note, children }: { title: string; note: string; children: ReactNode }) {
  return (
    <section style={{ marginBlockEnd: 28 }}>
      <h2 style={{ margin: '0 0 2px', fontSize: 14 }}>{title}</h2>
      <p style={{ margin: '0 0 8px', color: 'var(--text-muted)' }}>{note}</p>
      {/* Border and radius from the HOST's tokens, wrapped around Hatua's. If
          the two vocabularies collided, this box and its contents would agree. */}
      <div
        style={{
          border: '1px solid var(--border-subtle)',
          borderRadius: 12,
          overflow: 'hidden',
          blockSize: 340,
        }}
      >
        {children}
      </div>
    </section>
  )
}

function ThemePage() {
  return (
    <div style={{ maxInlineSize: 1300, margin: '0 auto', padding: '20px 16px 60px' }}>
      <h1 style={{ fontSize: 18, margin: '0 0 4px' }}>Themes, and the Host's CSS</h1>
      <p style={{ margin: '0 0 6px', maxInlineSize: 760 }}>
        This page declares its own <code style={{ font: '12px var(--font-mono)' }}>--accent</code>,{' '}
        <code style={{ font: '12px var(--font-mono)' }}>--surface-card</code>,{' '}
        <code style={{ font: '12px var(--font-mono)' }}>--radius-md</code> and{' '}
        <code style={{ font: '12px var(--font-mono)' }}>--text-primary</code> on{' '}
        <code style={{ font: '12px var(--font-mono)' }}>:root</code>. Everything pink is the Host's,
        painted from those. Everything inside a bordered box is Hatua, which names every property it
        writes <code style={{ font: '12px var(--font-mono)' }}>--hatua-*</code> and so reads none of
        them.
      </p>
      <p style={{ margin: '0 0 20px' }}>
        <button
          type="button"
          style={{
            border: 0,
            padding: '7px 15px',
            borderRadius: 'var(--radius-md)',
            background: 'var(--accent)',
            color: '#fff',
            font: 'inherit',
            cursor: 'pointer',
          }}
        >
          A Host button, at the Host's radius
        </button>{' '}
        <a href="/index.html">default embedding</a> · <a href="/host.html">Host-authored</a> ·{' '}
        <a href="/api.html">API-backed</a>
      </p>

      {THEMES.map(({ name, note, theme, workflows }) => (
        <Frame key={name} title={name} note={note}>
          <Hatua
            theme={theme}
            ports={{ manifests: SOURCES.ready, workflows }}
            workflowId="wf_theme"
          />
        </Frame>
      ))}

      {/*
        The same claim at region scale. A Host composing parts mounts its own
        markup INSIDE <HatuaProvider> — this grid is the Host's — which is the
        case where an unprefixed Hatua alias would have shadowed the Host's own
        for everything in the subtree.
      */}
      <Frame
        title="A Host's markup inside the provider"
        note="The pink strip is the Host's, rendered inside HatuaProvider, still reading the Host's tokens."
      >
        <HatuaProvider
          theme={createTheme({ accent: 'oklch(0.58 0.14 150)' })}
          ports={{ manifests: SOURCES.ready }}
        >
          <div
            style={{ display: 'grid', gridTemplateRows: 'auto minmax(0, 1fr)', blockSize: '100%' }}
          >
            <p
              style={{
                margin: 0,
                padding: '6px 12px',
                background: 'var(--accent-wash)',
                color: 'var(--text-primary)',
                borderBottom: '1px solid var(--border-subtle)',
              }}
            >
              Host markup, inside the provider, still the Host's pink.
            </p>
            <Library />
          </div>
        </HatuaProvider>
      </Frame>
    </div>
  )
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <ThemePage />
  </StrictMode>,
)
