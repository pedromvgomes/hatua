import type { StorybookConfig } from '@storybook/react-vite'

const config: StorybookConfig = {
  framework: '@storybook/react-vite',
  stories: ['../src/**/*.stories.tsx'],
  // Deliberately no addons and no static directory: no global stylesheet gets
  // in through the back door here (ADR-0003).
  //
  // Storybook is not, however, the place that PROVES the ADR. Its builder reads
  // ../vite.config.ts and then bundles the package from source, so each
  // primitive's class-map import is extracted into a chunk stylesheet and the
  // stories would look right even if <style href precedence> did nothing. The
  // playground build is what proves it: there the extracted asset and its <link>
  // are both removed, so anything that paints came from a component.
  addons: [],
  // Nothing about a component library's stories is worth phoning home about,
  // and CI should not depend on a network call it does not need.
  core: { disableTelemetry: true },
}

export default config
