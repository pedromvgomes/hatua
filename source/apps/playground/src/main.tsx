import { Hatua } from '@hatua/react'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

// The Host imports no CSS — Hatua renders its own stylesheet (ADR-0003).
createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <Hatua>
      <p style={{ padding: 24 }}>Hatua scaffold — designer lands here.</p>
    </Hatua>
  </StrictMode>,
)
