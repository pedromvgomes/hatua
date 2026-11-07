---
about: "Hatua logs through @vipengele/ts-core-observability/logger, kept external in the services and react builds; library code never configures logging, only the playground does"
saw:
  - source/packages/services/src/editing.ts
  - source/packages/services/vite.config.ts
  - source/packages/react/src/layouts/Fields.tsx
  - source/packages/react/vite.config.ts
  - source/apps/playground/src/main.tsx
  - source/apps/playground/src/workflow-store.ts
---
- Library code only asks for a logger: `Logging.logger('services.editing')`
  (services/src/editing.ts:369) and `Logging.logger('react.fields')`
  (react/src/layouts/Fields.tsx:587). Neither package calls `Logging.configure`, so a Host decides
  where records go. The vipengele logger has no sink until a Host adds one, so Hatua prints nothing
  by default, including at `warn` and above.
- `/^@vipengele\//` sits in `build.rollupOptions.external` in services/vite.config.ts:7 and
  react/vite.config.ts:53. Without it, Rollup bundles a private copy of the logger into Hatua's
  `dist/`. A new dependency in react or services needs the same entry, because each externalises
  only what it lists. Level state agrees across duplicate installed copies because vipengele keeps
  it in `globalThis` slots; the `^0.2.1` range does not provide that.
- The playground is the only place that configures logging
  (apps/playground/src/main.tsx). It adds `createConsoleSink()`,
  `addBrowserSources({ storageKey: 'hatua.log' })` and `Logging.installConsole('hatuaLogging')`.
  The spec is `category:level` entries joined by `,`, and a bare level is rejected. `?log=` is read
  and never stored.
- apps/playground/src/workflow-store.ts calls `console.info` directly when it takes over a live
  claim. That output bypasses the logger and prints whatever level is configured.
