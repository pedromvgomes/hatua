import { Hatua } from '@hatua/react'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { SOURCES } from './catalogue'

// The Host imports no CSS — Hatua renders its own stylesheet (ADR-0003).

/**
 * The default embedding: a Host writes <Hatua> and nothing else. It mounts the
 * provider and the designer screen, so everything visible below arrived from
 * one element and one import.
 *
 * It now passes one thing: `ports`. That is not a third way to embed — it is
 * the Host answering the only question Hatua cannot answer for itself. Hatua
 * never invents a Component, so a designer with no ManifestSource has an empty
 * Library by definition, and the alternative to a prop here is Hatua shipping a
 * catalogue of its own, which is the thing CONTEXT.md says it does not do.
 *
 * This entry takes the happy path deliberately, and takes it at build time: its
 * catalogue is compiled into the bundle, so the Library renders on the first
 * frame with no request behind it. The Library's slow, failing and empty states
 * are exercised by host.tsx, where a Host can switch between them; api.tsx is
 * the same designer as this one with the manifests fetched at run time, which
 * is the shape a real Host has.
 *
 * There is no <Scaffold> around it any more, and nothing passed as children.
 * <Hatua> renders <Build>; children would have been a third way to embed
 * sitting between the two we promise, so they are gone. The primitives this
 * file used to lay out by hand are documented in the Storybook, which is where
 * a component library's parts belong.
 *
 * The other entries are host.tsx at /host.html — the same designer assembled by
 * the Host itself, which never imports <Hatua> — and api.tsx at /api.html.
 * Keeping them apart is what makes ADR-0003's claim measurable: the per-entry
 * bundles in dist/ show what each way of embedding actually costs, and which of
 * them carries the catalogue.
 */
createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <Hatua ports={{ manifests: SOURCES.ready }} />
  </StrictMode>,
)
