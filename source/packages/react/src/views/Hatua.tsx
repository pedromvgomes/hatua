import type { Theme } from '../theme/createTheme'
import { type ColorMode, HatuaProvider, type HostPorts } from '../theme/HatuaProvider'
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
  /**
   * The Host's implementations of the ports Hatua reads. The default embedding
   * still writes one element and nothing else — but a designer that showed the
   * Host's own Components without being told where they live would have had to
   * invent them, and Hatua invents none.
   */
  ports?: HostPorts
  /**
   * Which Workflow Definition to open, as the Host's `WorkflowStore` addresses
   * it. Hatua has no storage and no idea where a workflow lives, so this and
   * `ports.workflows` are the whole of that seam — omit either and the designer
   * says it has nothing to edit rather than inventing something.
   */
  workflowId?: string
}

export function Hatua({ theme, colorMode, ports, workflowId }: HatuaProps) {
  return (
    <HatuaProvider theme={theme} colorMode={colorMode} ports={ports} workflowId={workflowId}>
      <Build />
    </HatuaProvider>
  )
}
