import type { Theme } from '../theme/createTheme'
import { type ColorMode, HatuaProvider } from '../theme/HatuaProvider'
import { Build } from './Build'

/**
 * The Hatua workflow designer.
 *
 * Renders the whole designer screen for the common case: the provider, and
 * <Build> inside it. A Host writes this and nothing else.
 *
 * It takes no children, and that is a decision rather than an omission. Until
 * now children were the only thing it could render, because there was no screen
 * to render instead. Now there is, and "children replace the screen" would be a
 * third way to embed sitting between the two we promise — a Host wanting its
 * own arrangement imports the regions and mounts <HatuaProvider> around them,
 * which is strictly more capable than a children slot and is the path
 * apps/playground/src/host.tsx keeps honest. A children slot would also have no
 * answer to "what does it mean to pass children AND get the designer", and both
 * answers are worse than not having the question.
 */
export interface HatuaProps {
  /** Optional; built with createTheme(). Defaults to Hatua's own palette. */
  theme?: Theme
  /** Omit to follow the Host's colour mode. */
  colorMode?: ColorMode
}

export function Hatua({ theme, colorMode }: HatuaProps) {
  return (
    <HatuaProvider theme={theme} colorMode={colorMode}>
      <Build />
    </HatuaProvider>
  )
}
