# Use the official OpenCode GitHub Action, with our own App token

Every role in the factory runs through `anomalyco/opencode/github`, not through a
hand-rolled `opencode run` wrapper. The action already does the things that would otherwise
be a week of plumbing: it checks out the repo, authenticates, passes the triggering comment
or PR context into the prompt, dispatches to a named agent, and comments the result back.

The one decision worth recording is the token. The action supports two modes: exchange a
GitHub OIDC token for an installation token of the official `opencode-agent` App, or accept
a caller-supplied `GITHUB_TOKEN`. We use the second, with the token belonging to our own
`convocados-factory[bot]` App, via `use_github_token: true`.

The reason is scope control. In OIDC mode the token's permissions are negotiated by a third
party we do not control, against a broker at `api.opencode.ai`, so the blast-radius
guarantees in ADR 0046 would be somebody else's promise. In token mode the App's scopes are
ours to set and ours to audit — no approve, no merge, no workflow write — and the run never
depends on a third-party service being reachable. The cost is one App to create and rotate
by hand, and no `id-token: write`.

One setting must be set deliberately: **`share: false`**. The action defaults `share` to
`true` on public repositories, and Convocados is public. A shared session publishes the
transcript, and a transcript of a failing test run can contain secret-shaped output — a
`DATABASE_URL` echoed by a migration error, a stack trace quoting a token. Sharing is
opt-in here, permanently.

The scheduling caveat is documented and must be respected: `schedule` runs have no user
context to permission-check against, so those workflows must grant `contents: write`,
`pull-requests: write`, and `issues: write` explicitly. Scheduled runs are the most
privileged workflows in the repository precisely because GitHub cannot ask anyone.
