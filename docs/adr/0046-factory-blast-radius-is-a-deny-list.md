# The factory's blast radius is a permission deny-list

Everything the factory must never do is expressed as an explicit `deny` in the agent
configuration, with everything else permitted by the surrounding `*` rule. Nothing the
factory does depends on a prompt being obeyed, and the rules live in committed YAML
frontmatter that any reviewer can read.

The mechanism is per-agent `permission` blocks: a Factory agent may `edit` the working tree
but not `.github/workflows/**` or `.github/CODEOWNERS`; a Repairer may `git push` to
`factory/*` but not `git push origin main`, `git push --no-verify`, or `gh pr merge`. The
denial that matters most is structural — an Explorer is read-only because `edit` is denied
and `task` is denied, so it cannot delegate writing to a subagent, rather than because it
promised not to.

Four denials that look like configuration but are actually safety requirements:

- **`question: deny` on every role.** A factory run has no human attached. An agent that
  asks a question does not fail fast, it stalls until the workflow times out.
- **`doom_loop: deny`.** OpenCode already detects the same tool call repeating three times.
  This is the infinite-repair-loop guard, and it must be `deny` rather than the default
  `ask`, because auto-approve would otherwise wave it through.
- **`external_directory: deny`.** Keeps every run inside its own checkout, so a run cannot
  read or write a sibling worktree or runner scratch space.
- **Model provider pinned** with `experimental.policies` — deny all, allow one. This is not
  blast radius, it is cost control: an unattended agent should not be able to select a
  provider nobody budgeted for.

The alternative — an allow-list of permitted commands — was rejected because it would
require enumerating every legitimate invocation across pnpm, Gradle, Playwright, git, and gh
in a config that breaks on the first unforeseen call. The cost of this choice is accepted
and specific: a wrong denial blocks a real action, and a Repairer burns an Attempt
discovering that. Denials therefore stay few, and each carries a comment saying why.
