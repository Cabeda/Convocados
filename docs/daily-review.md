# Daily senior review

A daily, unattended OpenCode session that reviews Convocados through six senior lenses and files
only the findings that clear the bar. It is how the owner gets a steady stream of **issues** to
decide on, without writing a prompt every day.

```
systemd timer 07:30
  → opencode run --agent daily-review
      → six read-only subagents (UX, architecture, QA, security, SRE, product)
      → orchestrator applies the bar, dedupes, caps
      → scripts/daily-review/file-issue.mjs  → GitHub issues (factory:explored)
      → scripts/daily-review/digest.mjs      → rolling "Daily reviews" Discussion
```

The orchestrator never writes code, never merges, and never applies `ready-for-agent`. It proposes;
Cabeda decides. Implementation stays with the [Delivery Factory](./factory/README.md) once an issue
is promoted.

## Why local, not GitHub Actions

The review runs as a **systemd user timer on the Pi** because it needs:

- the owner's `gh` identity (issues and comments are authored by Cabeda, not a bot),
- the global skills installed by `dotfiles/install-skills.sh` (`~/.agents/skills`,
  `~/.config/opencode/skills`),
- the provider auth already configured in `~/.local/share/opencode/auth.json`,
- read-only access to production health and logs.

A GitHub Actions run would need a separate bot identity and would not have the dotfiles skills.
The same agent can be run manually anywhere; the timer is only the scheduler.

## Roles

| Agent | Lens | Returns |
|---|---|---|
| `daily/ux` | Senior product designer: journeys, mobile, states, accessibility, parity | Findings with a repro and a viewport |
| `daily/architecture` | Smallest structural change that removes a class of bugs | Findings with call paths and a first test |
| `daily/qa` | Inputs, races, missing tests, CI flakes | Findings with a failing command or a precise repro |
| `daily/security` | Reachable authz, tokens, injection, supply chain | Findings with an impact and a request sequence |
| `daily/sre` | Reliability, resilience, cost | Findings with a measurement |
| `daily/product` | Existing feature value, researched proposals | Findings with research + prototype + success signal |

The shared contract lives in [`.opencode/skills/daily-review/SKILL.md`](../.opencode/skills/daily-review/SKILL.md);
the role playbooks are in `references/`.

## Install

```bash
scripts/daily-review/install.sh
```

This renders `systemd/user/convocados-daily-review.{service,timer}` into
`~/.config/systemd/user/`, creates `~/.config/convocados/daily-review.env` on first run, and enables
the timer. It also checks `loginctl` lingering; if it is off, the timer will not run while you are
logged out:

```bash
sudo loginctl enable-linger "$USER"
```

Remove it with:

```bash
scripts/daily-review/install.sh --uninstall
```

The units, the env file and the logs are left in place on uninstall.

## Run manually

```bash
scripts/daily-review/run.sh            # one full run
scripts/daily-review/run.sh --dry-run  # preflight + command, no model call
```

The runner is `flock`-guarded, so a manual run and the timer cannot overlap. It logs to
`~/.local/state/convocados/daily-review/<date>.log`, writes `last-run.txt` / `last-failure.txt`,
and keeps 30 days of logs. The digest is the durable record.

## Configuration

`~/.config/convocados/daily-review.env`:

| Variable | Default | Meaning |
|---|---|---|
| `DAILY_REVIEW_MODEL` | `opencode-go/deepseek-v4.1-flash` | Model for the session (subagents inherit). Use a stronger model for deeper judgment; the caps bound the cost. |
| `DAILY_REVIEW_MAX_ISSUES` | `6` | Hard cap per run, enforced by `file-issue.mjs`. |
| `DAILY_REVIEW_MAX_PER_ROLE` | `2` | Hard cap per lens per run. |
| `DAILY_REVIEW_DIGEST` | `discussion` | `discussion` or `off`. |
| `DAILY_REVIEW_DISCUSSION_CATEGORY` | `General` | Discussion category for the rolling log. |
| `DAILY_REVIEW_OWNER` / `DAILY_REVIEW_REPO` | `Cabeda` / `Convocados` | Repository for the digest. |

`opencode run --standalone` is used so the daily session does not share a server with the TUI.

## What it files

- Title prefix: `[UX]`, `[Architecture]`, `[QA]`, `[Security]`, `[SRE]`, `[Product]`.
- Label: `factory:explored` — the same label the read-only Explorers use. **Never**
  `ready-for-agent`.
- Body: pillar, severity, confidence, cost, what, why now, evidence, reproduction (where relevant),
  research/prototype (product), acceptance criterion, trade-offs, blast radius, files, fingerprint.
- The fingerprint (`role:path:symbol`) is the dedupe key. `file-issue.mjs` checks open and closed
  issues; a duplicate with genuinely new evidence can comment instead of filing.

Severity:

- **P0** — data loss, auth bypass, payment error, secret exposure, outage: file, comment the linked
  Change, mention `@Cabeda` in the digest.
- **P1** — a core journey blocked/unreliable, or a plausible security exploit: file.
- **P2** — measured friction, waste, or maintenance risk: file within the cap.
- **P3** — polish/taste: digest only, no issue.

Confidence must be high or medium; cost must be S or M unless P0. The orchestrator must state the
strongest argument **against** filing and why the finding still wins.

## Skills

OpenCode discovers skills from `~/.agents/skills` and `~/.config/opencode/skills` globally, so the
skills installed by `dotfiles/install-skills.sh` are available to every lens. The runner writes a
preflight to `~/.local/state/convocados/daily-review/preflight.txt` listing the roots, the count,
and any lock-file skill that is missing. A missing skill degrades the run; the digest says so.

The repo also carries the review contract at `.opencode/skills/daily-review/`, so the agents work
even on a machine without the personal skills.

## Logs and troubleshooting

```bash
systemctl --user list-timers convocados-daily-review.timer
systemctl --user status convocados-daily-review.service
journalctl --user -u convocados-daily-review.service -n 100
cat ~/.local/state/convocados/daily-review/last-failure.txt
```

Common causes:

- **`gh auth` failed** — re-run `gh auth login`; the runner records `gh_auth=FAILED` in preflight.
- **Fly token expired** — the SRE lens falls back to `/api/health` and the code; the digest notes it.
- **No issues filed** — a successful run when nothing cleared the bar. Read the digest for what was
  checked and deferred.
- **Timer did not fire** — check lingering, `systemctl --user status`, and the timer's `Persistent`
  catch-up after boot.

## Cost

One session per day: six read-only lenses plus a synthesis. The caps bound the **output**, not the
token spend; a stronger model or a broad repo read costs more. Start with the default flash model,
read a week of digests, then move to a stronger model only if the findings are too shallow.

## Adding a lens

1. Add `.opencode/agents/daily/<name>.md` with `mode: subagent`, read-only permissions, and a
   reference file under `.opencode/skills/daily-review/references/`.
2. Add the agent ID to the orchestrator's `subagent` allow list.
3. Add the role to `ROLES`/`ROLE_TITLES` in `scripts/daily-review/file-issue.mjs` and the schema's
   role-specific requirements.
4. Add it to the dispatch list in `.opencode/agents/daily-review.md` and the digest template.
5. Add a test fixture for the new role in `src/test/daily-review.test.ts`.

## Relationship to the Delivery Factory

The daily review is upstream of the factory: it produces evidenced issues, Cabeda promotes the ones
worth doing with `ready-for-agent`, and the factory turns them into Changes. The daily review never
labels, merges or deploys. The factory's own explorers remain for their scheduled focuses; this
review is the daily cross-lens pass the owner asked for.
