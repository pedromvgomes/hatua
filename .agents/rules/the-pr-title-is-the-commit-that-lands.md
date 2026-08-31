# The PR title is the commit that lands

This repository squash-merges, and the squash commit takes the **pull request's title**:

```
settings:
  merge:
    squash: true
    squash_title: pr_title
    squash_message: blank
```

So `main`'s history is one commit per PR, subject-lined by the PR title, and the commits written on
a branch never reach it. `git log main` is a list of PR titles.

## What that means for each

**The PR title is history, and it is linted.** `conventional_commits` runs against it, and its scope
pattern is `(\([a-zA-Z0-9][a-zA-Z0-9._/-]*\))?` — **a comma is rejected**. So a title takes one scope
or none:

```
✓  feat(model): a Segment becomes a Block
✓  fix: the upstream walk copies only where it descends
✗  feat(model,react): …          the check fails, and the PR cannot merge
```

Name the scope the change is *about* rather than every package it touches — the body is where the
rest goes, and a title is read in a list of forty others.

**A branch's commits are working notes.** Nothing lints them and nothing merges them, so they are
free to say what is most useful while the branch is being read as a series — including the
multi-scope form the linter refuses:

```
fix(model,layout,react,sdk): four the suites could not see
```

That is not a divergence to reconcile. Two surfaces with different readers and different lifetimes
are allowed different conventions, and the one that survives is the one that is checked.

## Do not try to fix this in `.gt-repo.yaml`

The scope pattern is not configurable from this repository. `gt repo config` resolves
`conventional_commits` to `enabled`, `scope` and `types` and nothing else; the regex lives in gt's
shared workflow template, which `.gt-repo.yaml` says by design:

> Shared policy … lives in gt's templates, not here, so it stays consistent across every governed
> repo.

Changing it means changing gt, in another repository, for every repo it governs. Pinning an override
here would also stop that setting tracking gt, which is what the file's own header warns against.
