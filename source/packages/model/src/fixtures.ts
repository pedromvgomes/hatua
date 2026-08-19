import type { Manifest, WorkflowDefinition } from '@hatua/schema'

/** Mirrors the worked example in the plan, so tests and docs cannot drift apart. */
export const DOC: WorkflowDefinition = {
  id: 'wf_morning_inbox_triage',
  name: 'Morning inbox triage',
  version: 8,
  status: 'draft',
  connections: [
    { id: 'mailbox', ref: 'conn_9f21c' },
    { id: 'brain', ref: 'conn_44b0e' },
    { id: 'notifier', ref: null },
  ],
  triggers: [
    { id: 'nightly', use: 'core.schedule', name: 'Weekday mornings', with: {} },
    {
      id: 'on_mail',
      use: 'email.received',
      name: 'When mail arrives',
      with: { connection: 'mailbox' },
    },
  ],
  vars: [{ key: 'digest_to', value: 'me@dane.dev' }],
  steps: [
    { id: 's2', use: 'email.fetch', name: 'Fetch emails', with: { connection: 'mailbox' } },
    {
      id: 's3',
      use: 'core.fork',
      name: 'Fork on new mail',
      with: { mode: 'condition' },
      branches: [
        {
          label: 'Has new mail',
          when: '{{s2.count}} > 0',
          steps: [
            {
              id: 's4',
              use: 'core.for_each',
              name: 'For each message',
              with: { list: '{{s2.messages}}' },
              steps: [
                { id: 's5', use: 'agent.act', name: 'Triage', with: { connection: 'brain' } },
              ],
            },
            { id: 's6', use: 'email.send', name: 'Send digest', with: { connection: 'mailbox' } },
          ],
        },
        { label: 'Otherwise', steps: [{ id: 's7', use: 'core.end', name: 'End' }] },
      ],
    },
  ],
}

export const MANIFESTS: Manifest[] = [
  {
    kind: 'component',
    use: 'email.send',
    name: 'Send email',
    fields: [{ k: 'connection', label: 'Mailbox', kind: 'conn', conn_type: 'email', req: true }],
    outputs: [{ k: 'message_id', label: 'Message ID', t: 'text' }],
  },
  {
    kind: 'component',
    use: 'email.fetch',
    name: 'Fetch emails',
    fields: [{ k: 'connection', label: 'Mailbox', kind: 'conn', conn_type: 'email', req: true }],
    outputs: [{ k: 'count', label: 'Count', t: 'number' }],
  },
  {
    // A trigger declares connections exactly as a component does — which is why
    // connection rules must check the triggers section too, not only steps.
    kind: 'trigger',
    use: 'email.received',
    name: 'When mail arrives',
    fields: [{ k: 'connection', label: 'Mailbox', kind: 'conn', conn_type: 'email', req: true }],
    outputs: [{ k: 'subject', label: 'Subject', t: 'text' }],
  },
  {
    kind: 'component',
    use: 'agent.act',
    name: 'Run agent',
    fields: [{ k: 'connection', label: 'Model', kind: 'conn', conn_type: 'llm', req: true }],
    outputs: [{ k: 'result', label: 'Result', t: 'text' }],
    metadata: [
      { k: 'tokens', label: 'Tokens used', t: 'number', role: 'measure', unit: 'tokens' },
      { k: 'model', label: 'Model', t: 'text', role: 'dimension' },
    ],
  },
]

/** What ConnectionDescriber.describe(ref).type would report. */
export const CONNECTION_TYPES: Record<string, string> = {
  conn_9f21c: 'email',
  conn_44b0e: 'llm',
}
