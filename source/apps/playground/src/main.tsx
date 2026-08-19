import { Hatua } from '@hatua/react'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

// The Host imports no CSS — Hatua renders its own stylesheet (ADR-0003).

/**
 * The default embedding: a Host writes <Hatua> and nothing else. It mounts the
 * provider and the designer screen, so everything visible below arrived from
 * one element and one import.
 *
 * There is no <Scaffold> around it any more, and nothing passed as children.
 * <Hatua> renders <Build>; children would have been a third way to embed
 * sitting between the two we promise, so they are gone. The primitives this
 * file used to lay out by hand are documented in the Storybook, which is where
 * a component library's parts belong.
 *
 * The other entry — host.tsx, served at /host.html — is the same designer
 * assembled by the Host itself, and it never imports <Hatua>. Keeping the two
 * apart is what makes ADR-0003's claim measurable: the per-entry bundles in
 * dist/ show what each way of embedding actually costs.
 */
createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <Hatua />
  </StrictMode>,
)
