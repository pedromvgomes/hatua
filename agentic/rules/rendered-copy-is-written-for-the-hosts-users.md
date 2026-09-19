# Rendered copy is written for the Host's users

Hatua is embedded. Everything it renders appears inside somebody else's product, to
somebody else's users — people who have never heard the word "Hatua", did not choose
it, and cannot act on anything expressed in its vocabulary.

So copy that reaches a screen during ordinary use never names Hatua, and never
explains itself in integrator terms.

## Two audiences, and the state tells you which

The distinction is not "which component" but **which state the copy belongs to**.

**Misconfiguration copy** renders only when the Host has not wired something up — a
missing port, no `workflowId`. A shipped product has its ports wired, so this text
can only ever reach the developer doing the integration. It *should* name Hatua and
name the prop, because otherwise they cannot tell what is asking them for it.

```tsx
// ✓ StepList, `status: 'unconfigured'` — the integrator is the only possible reader
No workflow is wired up. Hatua has no storage of its own — a Host supplies it as
ports={{ workflows }}, and names which workflow to open as workflowId.
```

**Runtime copy** renders when everything is wired correctly and the answer is simply
empty, or absent, or not yet chosen. An end user sees this. It must not name Hatua,
the Host, ports, or manifests.

```tsx
// ✗ renders on `status: 'ready'` with an empty catalogue — an end user's screen
This Host has declared no Components yet. Everything the Library shows comes from
its Component Manifests — Hatua invents none.

// ✓ same state, said to the person actually looking at it
No components are available yet.
```

## The vocabulary that travels with it

Dropping the word "Hatua" is not enough. These are integrator terms, and a sentence
that avoids the name while keeping them has not moved audience:

- **Hatua** — the library's name
- **Host** — "this Host has declared…", "a Host supplies…"
- **port**, **`ports={{ … }}`**, **`<HatuaProvider>`**, any prop or type name
- **Component Manifest**, **Function Manifest**, **ManifestSource** — the *file* is an
  integrator concept even though **Component** and **Function** are user-facing terms

Domain terms from `CONTEXT.md` — Step, Component, Trigger, Reference, Function,
Workflow — are exactly what a user building a workflow is looking at, and stay.

## Applies to

Every string that can reach the DOM: region copy, empty and error states, `aria-label`
and `alt`, placeholder text, live-region announcements, toasts and confirm dialogs.

Not comments, docstrings, Storybook prose, test names or ADRs — those are written for
whoever works on this repository, and naming Hatua there is the clearest thing to do.

## The test

**Would this sentence make sense to someone who does not know they are using an
embedded library, and could they act on it?** If acting on it requires editing code
they do not own, it belongs in the misconfiguration branch instead — and if it can
render in a correctly-wired product, it is the wrong sentence.
