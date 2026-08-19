import { Button, ConfirmDialog, Hatua, Input, Select, Toast, Toggle } from '@hatua/react'
import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'

// The Host imports no CSS — Hatua renders its own stylesheet (ADR-0003).

/**
 * The default embedding: a Host writes <Hatua> and nothing else. It mounts the
 * provider, which carries the theme and the overlay container, so every part
 * below is themed without the Host arranging anything.
 *
 * The other entry — host.tsx, served at /host.html — is the same designer
 * assembled by the Host itself, and it never imports <Hatua>. Keeping the two
 * apart is what makes ADR-0003's claim measurable: the per-entry bundles in
 * dist/ show what each way of embedding actually costs.
 */
function Scaffold() {
  const [parallel, setParallel] = useState(false)
  const [toast, setToast] = useState(false)
  const [confirming, setConfirming] = useState(false)

  return (
    <div
      style={{ display: 'grid', gap: 16, padding: 24, minHeight: '100vh', alignContent: 'start' }}
    >
      <p style={{ margin: 0, color: 'var(--text-secondary)' }}>
        Hatua scaffold — the designer lands here. Until it does, the primitives.
      </p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <Button variant="primary" onClick={() => setToast(true)}>
          Publish
        </Button>
        <Button variant="danger" onClick={() => setConfirming(true)}>
          Discard Draft
        </Button>
        <Button variant="ghost">Text Mode</Button>
      </div>

      <div style={{ display: 'grid', gap: 8, maxWidth: 320 }}>
        <Input aria-label="Digest recipient" placeholder="{{ var.digest_to }}" />
        <Select aria-label="Component" defaultValue="core.fork">
          <option value="email.send">email.send</option>
          <option value="core.fork">core.fork</option>
          <option value="data.map">data.map</option>
        </Select>
        <Toggle checked={parallel} onCheckedChange={setParallel} label="Run branches in parallel" />
      </div>

      <Toast open={toast} tone="success" autoDismissAfter={6} onDismiss={() => setToast(false)}>
        Draft published as version 4.
      </Toast>

      <ConfirmDialog
        open={confirming}
        tone="danger"
        title="Discard this Draft?"
        description="Its version number goes back into the pool and the edits are lost."
        confirmLabel="Discard Draft"
        onConfirm={() => setConfirming(false)}
        onCancel={() => setConfirming(false)}
      />
    </div>
  )
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <Hatua>
      <Scaffold />
    </Hatua>
  </StrictMode>,
)
