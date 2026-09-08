import type { Cursor, ExecutionSource, ExecutionSummary } from '@hatua/services'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { RunList } from './RunList'

/**
 * Every state the run list has, against a fake `ExecutionSource`.
 *
 * The two absences are the pair worth looking at side by side: a Host that
 * wired no port and a workflow that has never run are different problems with
 * different fixes, and only one of them is the reader's.
 */

const HISTORY: ExecutionSummary[] = [
  { runId: 'run_8f2', status: 'failed', startedAt: '2026-08-18T07:00:00.000Z', durationMs: 1470 },
  { runId: 'run_7c9', status: 'running', startedAt: '2026-08-18T06:00:00.000Z' },
  { runId: 'run_6b4', status: 'succeeded', startedAt: '2026-08-17T07:00:00.000Z', durationMs: 920 },
  {
    runId: 'run_5a1',
    status: 'succeeded',
    startedAt: '2026-08-16T07:00:00.000Z',
    durationMs: 74_000,
  },
]

const source = (
  pages: Cursor<ExecutionSummary>[],
  options: { hang?: boolean; fail?: Error } = {},
): ExecutionSource => {
  let index = 0
  return {
    listExecutions() {
      if (options.hang) return new Promise<Cursor<ExecutionSummary>>(() => {})
      if (options.fail) return Promise.reject(options.fail)
      const page = pages[Math.min(index, pages.length - 1)]
      index += 1
      return Promise.resolve(page as Cursor<ExecutionSummary>)
    },
    loadExecution() {
      return Promise.reject(new Error('Not part of this story.'))
    },
  }
}

const wired = (executions: ExecutionSource | null) => ({
  ports: executions ? { executions } : {},
  workflowId: 'wf',
})

const meta = {
  title: 'Layouts/RunList',
  component: RunList,
  decorators: [
    (Story) => (
      <div
        style={{ blockSize: 620, inlineSize: 304, border: '1px solid var(--hatua-border-subtle)' }}
      >
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof RunList>

export default meta
type Story = StoryObj<typeof meta>

/**
 * A workflow with history. Each row says when it ran, how long it took and what
 * happened — in words as well as in the dot, because a colour is the one thing
 * a reader may not have.
 */
export const History: Story = { parameters: wired(source([{ items: HISTORY }])) }

/**
 * A further page to walk to. Run history is the list `ports.ts` names when it
 * says every unbounded list is paged: a workflow that runs nightly for three
 * years is walked rather than swallowed.
 */
export const MorePages: Story = {
  parameters: wired(
    source([{ items: HISTORY.slice(0, 2), next: 'p2' }, { items: HISTORY.slice(2) }]),
  ),
}

/** A workflow that has never run. Runtime copy, said to the person looking at it. */
export const NothingHasRun: Story = { parameters: wired(source([{ items: [] }])) }

/**
 * No `ExecutionSource`. Misconfiguration copy: a shipped product has its ports
 * wired, so the only possible reader is the integrator — and this names the prop
 * that fixes it.
 */
export const NoPort: Story = { parameters: wired(null) }

/** The first page in flight. There is nothing to show and nothing to page from. */
export const Loading: Story = { parameters: wired(source([], { hang: true })) }

/** The first page failed, so the list has nothing to fall back on. */
export const Failed: Story = {
  parameters: wired(source([], { fail: new Error('Run history is unavailable right now.') })),
}
