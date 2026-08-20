import type { Decorator, Preview } from '@storybook/react-vite'
import { HatuaProvider, type HostPorts } from '../src/theme/HatuaProvider'

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
 *
 * A story that needs a Host port declares one as `parameters.ports` and this
 * decorator hands it to the provider; one that needs to mount the provider
 * itself declares `parameters.provider = false` and is handed the frame bare. It is set here rather than by the story
 * mounting its own provider, because a nested provider would mean the two
 * colour panels shared one root and the region under review no longer sat where
 * a real embedding puts it.
 */
const bothColourModes: Decorator = (Story, context) => {
  const ports = context.parameters.ports as HostPorts | undefined

  // A story ABOUT the provider cannot be rendered inside one it does not
  // control — it needs to mount its own, with its own themes and its own modes,
  // and often more than one at a time. `parameters: { provider: false }` hands
  // it the frame bare. See theme/theming.stories.tsx.
  if (context.parameters.provider === false) return <Story />

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', minHeight: '100vh' }}>
      <HatuaProvider colorMode="light" ports={ports}>
        <div style={{ padding: 24 }}>
          <Story />
        </div>
      </HatuaProvider>
      <HatuaProvider colorMode="dark" ports={ports}>
        <div style={{ padding: 24 }}>
          <Story />
        </div>
      </HatuaProvider>
    </div>
  )
}

const preview: Preview = {
  decorators: [bothColourModes],
  parameters: {
    layout: 'fullscreen',
    controls: { expanded: true },
  },
}

export default preview
