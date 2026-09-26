# One human gate: CODEOWNERS is the merge authority

The Delivery Factory has full write access to the repository — it branches, commits, pushes,
and opens Changes — and is nevertheless never permitted to merge one. `.github/CODEOWNERS`
is `* @Cabeda`, so every file in the repo requires Cabeda's review, and branch protection
refuses to satisfy a review requirement with the PR author's own approval.

This is deliberately the load-bearing piece, not a policy layered on top. `release.yml`
fires on CI green against `main` and then bumps the version, tags, releases, deploys Fly,
publishes Android to the Play internal track, and deploys the scheduler — so merging is
deploying. A machine with merge rights would be a machine that ships.

Two consequences fall out of the constraint. The factory authenticates as a GitHub App
rather than as Cabeda, because a PR authored by a required code owner can never be reviewed
by that owner. And the App is never added to `CODEOWNERS`, so it cannot satisfy its own
review requirement even if it wanted to.

The rejected alternative was a machine-merge with a human approval comment. It reads like
the same guarantee and is not: it moves the click somewhere it can be automated, and the
moment it does, the guarantee is gone.
