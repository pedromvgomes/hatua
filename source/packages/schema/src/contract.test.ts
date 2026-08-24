/** biome-ignore-all lint/correctness/noNodejsModules: a Node test reading fixtures from disk; nothing here ships to a browser. */
import { describe, expect, it } from 'vitest'
import { componentManifest, functionManifest, workflowDefinition, workflowExecution } from './index'

// The shape agreed in the plan: triggers as a section, connections holding only
// an opaque ref, vars as key/value objects, no `inputs`, no core.start.
const DEFINITION = {
  id: 'wf_morning_inbox_triage',
  name: 'Morning inbox triage',
  version: 8,
  status: 'draft',
  connections: [
    { id: 'mailbox', ref: 'conn_9f21c' },
    { id: 'notifier', ref: null },
  ],
  triggers: [
    {
      id: 'nightly',
      use: 'core.schedule',
      name: 'Weekday mornings',
      with: { cron: '0 7 * * 1-5' },
    },
  ],
  vars: [{ key: 'digest_to', value: 'me@dane.dev' }],
  steps: [
    {
      id: 's2',
      use: 'component.email.fetch',
      name: 'Fetch emails',
      with: { connection: 'mailbox' },
    },
    {
      id: 's3',
      use: 'core.fork',
      with: { mode: 'condition' },
      branches: [
        {
          label: 'Has new mail',
          when: '{{steps.s2.count}} > 0',
          steps: [
            {
              id: 's4',
              use: 'core.for_each',
              with: { list: '{{steps.s2.messages}}' },
              steps: [{ id: 's5', use: 'component.agent.act' }],
            },
          ],
        },
        { label: 'Otherwise', steps: [] },
      ],
    },
  ],
}

describe('workflowDefinition', () => {
  it('accepts the agreed shape, nested branches and loops included', () => {
    const result = workflowDefinition.safeParse(DEFINITION)
    expect(result.error?.issues).toBeUndefined()
    expect(result.success).toBe(true)
  })

  it('allows a null connection ref — unconnected blocks publish, not editing', () => {
    expect(workflowDefinition.safeParse(DEFINITION).success).toBe(true)
  })

  it('rejects a version below 1, since publish allocates from 1', () => {
    expect(workflowDefinition.safeParse({ ...DEFINITION, version: 0 }).success).toBe(false)
  })

  it('rejects an unknown status', () => {
    expect(workflowDefinition.safeParse({ ...DEFINITION, status: 'live' }).success).toBe(false)
  })

  it('rejects a step with no stable id, since References point at it', () => {
    const bad = { ...DEFINITION, steps: [{ use: 'core.end' }] }
    expect(workflowDefinition.safeParse(bad).success).toBe(false)
  })

  it('rejects unknown top-level keys, so a typo is not silently ignored', () => {
    expect(workflowDefinition.safeParse({ ...DEFINITION, inputs: [] }).success).toBe(false)
  })

  it('preserves recursion through arbitrary nesting depth', () => {
    const parsed = workflowDefinition.parse(DEFINITION)
    const fork = parsed.steps[1]
    expect(fork?.branches?.[0]?.steps?.[0]?.steps?.[0]?.id).toBe('s5')
  })
})

describe('workflowExecution', () => {
  const EXECUTION = {
    run_id: 'run_8f215',
    status: 'failed',
    workflow: { id: 'wf_morning_inbox_triage', version: 7 },
    trigger: { id: 'nightly', payload: { triggered_at: '2026-08-18T07:00:00Z' } },
    started_at: '2026-08-18T07:00:00.000Z',
    duration_ms: 1470,
    steps: [
      {
        id: 's4',
        status: 'succeeded',
        iterations: [
          {
            index: 0,
            status: 'succeeded',
            steps: [
              {
                id: 's5',
                status: 'succeeded',
                metadata: { tokens: 1840, model: 'claude-haiku-4-5' },
              },
            ],
          },
          {
            index: 1,
            status: 'failed',
            steps: [
              {
                id: 's5',
                status: 'failed',
                error: { message: 'timed out', code: 'UPSTREAM_TIMEOUT' },
              },
            ],
          },
        ],
      },
    ],
  }

  it('accepts per-iteration records for a loop', () => {
    const result = workflowExecution.safeParse(EXECUTION)
    expect(result.error?.issues).toBeUndefined()
    expect(result.success).toBe(true)
  })

  it('references a definition version rather than embedding one', () => {
    const parsed = workflowExecution.parse(EXECUTION)
    expect(parsed.workflow.version).toBe(7)
    // If the definition were embedded there would be a `steps` tree here.
    expect('definition' in parsed).toBe(false)
  })

  it('carries no run-level metadata — Hatua derives totals from per-step values', () => {
    const withTotals = { ...EXECUTION, metadata: { tokens: 42180 } }
    expect(workflowExecution.safeParse(withTotals).success).toBe(false)
  })
})

describe('componentManifest', () => {
  const MANIFEST = {
    kind: 'component',
    use: 'component.email.send',
    name: 'Send email',
    group: 'Email',
    icon: '/icons/mail.svg',
    blurb: 'Send a message through a connected mailbox.',
    fields: [
      { k: 'connection', label: 'Mailbox', kind: 'conn', conn_type: 'email', req: true },
      { k: 'to', label: 'To', kind: 'text', req: true },
    ],
    outputs: [{ k: 'message_id', label: 'Message ID', t: 'text' }],
    metadata: [
      { k: 'tokens', label: 'Tokens used', t: 'number', role: 'measure', unit: 'tokens' },
      { k: 'model', label: 'Model', t: 'text', role: 'dimension' },
    ],
  }

  it('accepts a single manifest', () => {
    const result = componentManifest.safeParse(MANIFEST)
    expect(result.error?.issues).toBeUndefined()
    expect(result.success).toBe(true)
  })

  it('accepts a catalogue of manifests', () => {
    expect(componentManifest.safeParse({ components: [MANIFEST] }).success).toBe(true)
  })

  it('requires a label on every output, not just every field', () => {
    const bad = { ...MANIFEST, outputs: [{ k: 'message_id', t: 'text' }] }
    expect(componentManifest.safeParse(bad).success).toBe(false)
  })

  it('requires a role on metadata, since derivation depends on measure vs dimension', () => {
    const bad = { ...MANIFEST, metadata: [{ k: 'tokens', label: 'Tokens', t: 'number' }] }
    expect(componentManifest.safeParse(bad).success).toBe(false)
  })

  it('accepts nested list output shapes', () => {
    const nested = {
      ...MANIFEST,
      outputs: [
        {
          k: 'messages',
          label: 'Messages',
          t: 'list',
          of: [{ k: 'subject', label: 'Subject', t: 'text' }],
        },
      ],
    }
    expect(componentManifest.safeParse(nested).success).toBe(true)
  })
})

describe('function manifest', () => {
  it('accepts every built-in Hatua ships, since it claims the same format', async () => {
    // "The format is identical and the only difference is who wrote the file"
    // has to be true of the files themselves, or a Host copying one as a
    // template gets a manifest its own validator rejects.
    const { readdirSync, readFileSync } = await import('node:fs')
    const { parse } = await import('yaml')
    const dir = new URL('../../../schemas/functions/', import.meta.url)

    const files = readdirSync(dir).filter((name) => name.endsWith('.yaml'))
    expect(files.length).toBeGreaterThan(0)

    for (const file of files) {
      const doc = parse(readFileSync(new URL(file, dir), 'utf8'))
      const result = functionManifest.safeParse(doc)
      expect(result.success, `${file}: ${JSON.stringify(result.error?.issues)}`).toBe(true)
    }
  })

  /*
   * `description` is optional in the schema and mandatory in Hatua's own
   * corpus, and the asymmetry is the decision rather than an oversight: a
   * Host's existing manifest has to keep validating, while a built-in with an
   * undescribed parameter is one the function builder cannot explain to
   * anybody. `readFunctions` refuses to generate without it; this says the same
   * thing where a reader of the suite can see it.
   */
  it('describes every parameter and namespace it ships, which the schema only invites', async () => {
    const { readdirSync, readFileSync } = await import('node:fs')
    const { parse } = await import('yaml')
    const dir = new URL('../../../schemas/functions/', import.meta.url)

    const undescribed: string[] = []
    for (const file of readdirSync(dir).filter((name) => name.endsWith('.yaml'))) {
      const doc = parse(readFileSync(new URL(file, dir), 'utf8'))
      if (!doc.summary?.trim()) undescribed.push(`${doc.namespace} (namespace)`)

      for (const fn of doc.functions ?? []) {
        if (!fn.summary?.trim()) undescribed.push(`${doc.namespace}.${fn.name}`)
        for (const param of fn.params ?? []) {
          if (!param.description?.trim()) {
            undescribed.push(`${doc.namespace}.${fn.name}(${param.name})`)
          }
        }
      }
    }
    expect(undescribed).toEqual([])
  })

  it('accepts a Host namespace declaration', () => {
    const manifest = {
      kind: 'function',
      namespace: 'crm',
      summary: 'Customer lookups.',
      functions: [
        {
          name: 'owner_of',
          summary: 'Who owns an account.',
          params: [{ name: 'account_id', type: 'text' }],
          returns: 'text',
        },
      ],
    }
    expect(functionManifest.safeParse(manifest).success).toBe(true)
  })

  it('accepts a catalogue of namespaces', () => {
    const catalogue = {
      namespaces: [
        { kind: 'function', namespace: 'crm', functions: [{ name: 'tier', returns: 'number' }] },
      ],
    }
    expect(functionManifest.safeParse(catalogue).success).toBe(true)
  })

  it('refuses a namespace that is not a plain lowercase name', () => {
    const manifest = {
      kind: 'function',
      namespace: 'CRM Lookups',
      functions: [{ name: 'tier', returns: 'number' }],
    }
    expect(functionManifest.safeParse(manifest).success).toBe(false)
  })

  it('refuses a return type outside the value space', () => {
    const manifest = {
      kind: 'function',
      namespace: 'crm',
      functions: [{ name: 'tier', returns: 'money' }],
    }
    expect(functionManifest.safeParse(manifest).success).toBe(false)
  })
})
