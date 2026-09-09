import { useState } from 'react'
import type { BarView } from '../layouts/TopBar'
import type { Theme } from '../theme/createTheme'
import { type ColorMode, HatuaProvider, type HostPorts } from '../theme/HatuaProvider'
import { Build } from './Build'
import { Runs } from './Runs'

/**
 * The Hatua workflow designer.
 *
 * Renders the whole screen for the common case: the provider, and one of the two
 * views inside it. A Host writes this and nothing else.
 *
 * **Which view is up is held here**, because this is the only thing that renders
 * both. It is chrome and never reaches the document, the same line ADR-0001 draws
 * around node positions — and it is not a prop, because a Host that wants to
 * decide has the other embedding, where it mounts the view it wants inside its
 * own <HatuaProvider>. The bar draws the control and owns neither view
 * (ADR-0011).
 *
 * **Text Mode is not one of them.** It is how a view's column draws the document
 * it already has, so each view holds that for itself and the toggle sits on the
 * column — which is what makes "the document did not change" visible rather than
 * a rule to remember (ADR-0026).
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
  /*
   * **Build** is where a workflow is opened, whatever else the Host serves.
   *
   * Not the last view a session happened to be on, and not one derived from
   * whether run history exists: the designer is what this component is for, and
   * a Host that wants to open somewhere else mounts the view it wants.
   */
  const [view, setView] = useState<BarView>('build')

  return (
    <HatuaProvider theme={theme} colorMode={colorMode} ports={ports} workflowId={workflowId}>
      {/*
        One at a time, and mounted rather than hidden. Each view owns what is on
        screen while it is up — the **Runs** view owns the **Preview** a run puts
        there (ADR-0025) — and a hidden view is one still holding it.

        A **Runs** view is only ever reached through the bar's control, which is
        not drawn without an `ExecutionSource`. So a Host that serves no run
        history cannot arrive here at all, and there is nothing to guard against.
      */}
      {view === 'runs' ? (
        <Runs view={view} onViewChange={setView} />
      ) : (
        <Build view={view} onViewChange={setView} />
      )}
    </HatuaProvider>
  )
}
