# Connections are established outside Hatua

A **Workflow Definition** stores nothing about a connection but an opaque `ref`. The **Host** returns
already-established connections, resolves that ref to credentials at run time, and answers
`describe(ref)` with everything shown to a user. Hatua implements no authentication of any kind.

An earlier draft of this design had a *connector manifest* with an `auth:` block —
`mode: oauth2`, scopes, the lot. That described a flow Hatua could never run: it has no server, so
it can hold no client secret and receive no redirect. Shipping the declaration without the ability
to honour it would have been worse than not having it.

The user-experience cost is real: finding mid-build that you need a new connection means leaving the
builder. That is addressed without giving Hatua any auth responsibility — `ConnectionSource` has an
optional `createConnection`, so Hatua renders "+ New connection", *invokes* a flow the Host owns
(modal, redirect, new tab — Hatua neither knows nor cares), and refetches.

## Why `ref` and not `token`

Identical semantics; the name is the point. A **Workflow Definition** is a file that lives in the
Host's repository, usually in git. A field called `token` invites someone committing a real
credential into version control. Nothing secret is ever stored in a definition.

## Consequences

- **Nothing human-readable is cached in the workflow.** No label, no description — so nothing can go
  stale when a connection is renamed. Everything comes from `describe(ref)`.
- **`ConnectionDescriber` is separate from `ConnectionSource`.** The detachable run viewer must
  describe the connections a run used, but never lists or creates any, so a viewer-only Host
  implements one small interface instead of the whole thing.
- **A null `ref` blocks publish, not editing.** Laying out a workflow before wiring up its
  connections is a legitimate intermediate state; forcing connections first would make the builder
  unusable in a fresh environment. A type *mismatch*, by contrast, blocks editing — it can only
  arise from a hand-edit.
- **There are only two manifest kinds**, `component` and `trigger`. Connection types arrive with the
  connections themselves, and a `conn` field matches against them via `conn_type`.
- **Per-use variation is a component field, not a connection option.** Two models means two
  connections, which keeps connections opaque and leaves one mechanism for varying behaviour.
