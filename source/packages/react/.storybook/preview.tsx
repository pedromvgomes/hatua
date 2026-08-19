import type { Decorator, Preview } from '@storybook/react-vite'
import { HatuaProvider } from '../src/theme/HatuaProvider'

/**
 * Storybook imports no stylesheet, here or anywhere (ADR-0003). Every rule a
 * story renders under arrives through a component's own <style href precedence>
 * — the base sheet through HatuaProvider, the rest through the primitives. An
 * `import './preview.css'` in this file would quietly void the ADR while making
 * every story look right, which is exactly why styles/tokens.test.ts scans this
 * directory too.
 *
 * Each story is rendered twice, once per pinned colour mode. Two panels rather
 * than a toolbar switch: a mode you have to go and select is a mode nobody
 * looks at, and the dark palette is a separate declaration block that can drift
 * from the light one without anything failing.
 */
const bothColourModes: Decorator = (Story) => (
  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', minHeight: '100vh' }}>
    <HatuaProvider colorMode="light">
      <div style={{ padding: 24 }}>
        <Story />
      </div>
    </HatuaProvider>
    <HatuaProvider colorMode="dark">
      <div style={{ padding: 24 }}>
        <Story />
      </div>
    </HatuaProvider>
  </div>
)

const preview: Preview = {
  decorators: [bothColourModes],
  parameters: {
    layout: 'fullscreen',
    controls: { expanded: true },
  },
}

export default preview
