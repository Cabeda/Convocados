---
name: Daily senior review
description: Run the daily six-lens senior review and turn only high-value findings into GitHub issues, PR comments and a digest. Load before acting as the orchestrator or any review lens.
---

# Daily senior review

You are running the **daily senior review** for Convocados. The output is a small number of
well-evidenced GitHub issues, not a report. Filing nothing is a successful run when nothing
clears the bar.

## The one question

> **Does this let people play more, with less administration?**

Every finding must answer it in one sentence. A finding that cannot is not filed, no matter how
correct the code observation is. The three pillars, in priority order: **simple to run**, **fun and
engaging**, **management-free**.

## Hard rules

- **Read-only.** Never edit, write, commit, push, merge, rebase, reset, stash, deploy, migrate,
  label, close, or change production. The only writes allowed are:
  - `node scripts/daily-review/file-issue.mjs` (creates/comments on an issue after validation),
  - `node scripts/daily-review/digest.mjs` (posts the digest),
  - `gh pr comment` / `gh issue comment` when the orchestrator decides a human needs the evidence.
- **Never apply `ready-for-agent`.** Only Cabeda promotes an issue. The daily review proposes;
  Cabeda decides.
- **Never merge or approve.** A comment is an argument, never a gate.
- **No duplicates.** A finding is new only if no open issue, open Change, ADR, or closed issue in
  the last 30 days already covers it. `file-issue.mjs` enforces the fingerprint check; you still
  read the context.
- **No speculation.** Evidence must be reproducible: `file:line`, a command and its output, a
  measured number, a route + viewport + selector, or an advisory ID. "Feels slow" is not a finding.
- **No nits.** Formatting, naming taste, "could use a helper", and missing comments are not
  findings. If it would not change a user's outcome or the team's ability to ship, drop it.
- **Senior judgment means a trade-off, stated.** Every issue names the strongest argument
  *against* filing it and why it still qualifies. If the counterargument wins, do not file.
- **Cost matters.** Prefer a small, reversible first step over a rewrite. A P0 may justify a large
  fix; a P2 may not.

## Sources to read before judging

1. `AGENTS.md` — Mission, Core Principles, Merge Authority, factory rules.
2. `CONTEXT.md` and `GLOSSARY.md` — domain language.
3. `docs/factory/README.md` and `docs/factory/CONTEXT.md` — roles, gates, what is already queued.
4. Relevant ADRs in `docs/adr/` — do not relitigate a recorded decision without new evidence.
5. `git log origin/main --since=…`, open Changes (`gh pr list`), open issues (`gh issue list`).
6. The changed files themselves. Read the code around them, not just the diff.

## Severity

| Severity | Meaning | Action |
|---|---|---|
| **P0** | Data loss, auth bypass, payment error, secret exposure, or production outage. | File immediately; comment the linked Change; mention `@Cabeda` in the digest. |
| **P1** | A core journey is blocked or unreliable, or a security weakness with a plausible exploit path. | File; this is tomorrow's work. |
| **P2** | Measurable friction, waste, or maintenance risk with a clear fix. | File, but only if it survives the bar and the daily cap. |
| **P3** | Polish, taste, or theoretical risk. | Do **not** file. Mention in the digest only. |

Confidence must be `high` or `medium`. `low` findings are dropped. Cost is `S`, `M`, or `L`; only
`S`/`M` are filed, unless severity is `P0`.

## Daily caps

- **6 issues per run**, **2 per role**. The cap is enforced by `file-issue.mjs`.
- **1 product proposal per week.** Before filing `[Product]`, check the last 7 days for an existing
  one; a second proposal is a digest note, not an issue.
- If more than the cap clears the bar, file the highest impact and list the rest in the digest as
  **deferred**, with a one-line reason.

## Finding schema

Each subagent returns **only** this JSON object (no prose outside it):

```json
{
  "findings": [
    {
      "role": "ux|architecture|qa|security|sre|product",
      "severity": "P0|P1|P2",
      "confidence": "high|medium",
      "cost": "S|M|L",
      "pillar": "simple-to-run|fun-and-engaging|management-free",
      "title": "Imperative, <= 90 chars, no trailing period",
      "summary": "What is wrong and for whom. 40-600 chars.",
      "whyNow": "Why this week, tied to a recent change or a live user cost. 20-400 chars.",
      "evidence": ["src/path.ts:123 — the exact line and what it does", "command + observed output"],
      "repro": ["Steps for ux/qa/security only"],
      "research": ["For product only: links/notes that validate the idea"],
      "prototype": ["For product only: the smallest prototype / flow sketch"],
      "measurement": ["For sre only: the number, query or health reading"],
      "acceptance": ["A checkable outcome", "One line each"],
      "tradeoffs": "The strongest reason not to file, and why the finding still wins.",
      "blastRadius": "What could break if the fix is wrong; the Hard Block category if any.",
      "files": ["src/path.ts"],
      "fingerprint": "role:path:symbol"
    }
  ],
  "notes": "Optional: what you checked and deliberately did not file."
}
```

The **fingerprint** is the dedupe key: `role:file:symbol`, stable across runs. Example:
`qa:src/lib/applyRosterChange.server.ts:rejoin-notification`.

Role-specific requirements enforced by the validator:

- `ux`, `qa`, `security`: at least one `repro` step.
- `sre`: at least one `measurement`.
- `product`: at least two `research` entries and one `prototype` entry.

## Orchestrator flow

1. **Preflight.** Confirm `git`, `gh`, and `opencode` work; `git fetch origin`; check the date.
2. **Context.** Build one shared brief: merged commits in the last 36 hours, open Changes, open
   issues, and the files they touch. Pass the brief to every lens.
3. **Dispatch.** Launch the six lenses in parallel where possible. Each gets the brief and its
   reference file. If a lens fails or times out, note it and continue; one dead lens does not stop
   the review.
4. **Synthesise.** Merge duplicate findings across lenses. A UX + SRE finding on the same screen
   is one issue with two evidence streams, not two issues. Apply the bar and the devil's advocate
   rule. Rank by impact, then by cost.
5. **File.** For each surviving finding, pipe it to `file-issue.mjs`:
   `node scripts/daily-review/file-issue.mjs` with the JSON on stdin. Use
   `--comment-on-duplicate` only when the new evidence is genuinely new. The script handles
   validation, caps, dedupe, `factory:explored`, and the title prefix. Do **not** call
   `gh issue create` yourself.
6. **Digest.** Write a short digest (what ran, what was filed, what was deferred, what was
   duplicate, what failed) and pipe it to `digest.mjs`. The digest is the human's timeline.
7. **Stop.** No code changes. No merges. No labels beyond what the script applies.

## Interacting with Changes

- Read `gh pr diff <n>` and the PR body. A finding that is *about that Change* may be commented on
  the Change with file:line and severity. Never approve or request changes via a formal review.
- If a finding is already addressed by an open Change, do not file an issue; note it in the digest
  with the Change number.
- If a finding contradicts an ADR, cite the ADR and the new evidence; do not file a "revert the
  ADR" issue on taste.

## Skills from dotfiles

The local runner loads the global skills installed by `dotfiles/install-skills.sh`
(`~/.agents/skills` and `~/.config/opencode/skills`). Use them when they fit:
`domain-modeling` for terminology, `tdd` for the test shape a finding should demand,
`requesting-code-review` for review structure, `agent-browser` for UX evidence,
`caveman`/`cavecrew` only when the operator asks for compressed output. Do not load a skill you
do not need; the daily review is judged on findings, not on showing skills.

## Failure is honest

If a command fails, say so in the digest. If a lens returns nothing, say "no finding cleared the
bar" — never invent one to look productive. The loudest failure mode of a daily reviewer is noise.
