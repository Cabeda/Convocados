# Issue Tracker (dex)

This project uses **[dex](https://dex.rip)** for issue tracking. Run `dex --help` for the CLI.

## Quick Reference

```bash
dex ready              # Find available work
dex show <id>          # View issue details
dex start <id>         # Claim work
dex complete <id> --result "what changed" --commit <sha>
                       # Complete work. BOTH flags are required: --result is the
                       # completion note, and --commit links the commit so the
                       # GitHub issue closes when that commit merges. Use
                       # --no-commit to complete without closing the issue.
dex sync               # Push tasks to GitHub Issues
```

## Rules

- Use `dex` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- GitHub sync is enabled with `on_change = true` (auto-sync on every mutation)
- Tasks are stored at `.dex/tasks.jsonl` (committed to repo) and synced to GitHub Issues
- The local ledger and GitHub Issues are **two ledgers**, not one, and they disagree by
  design — including for machine-filed tasks, which follow a different path back. The
  ownership table and the machine exception live in
  [`docs/development-guide.md`](docs/development-guide.md); reach for it when a task's
  GitHub state does not match the ledger.
- `dex` reads the **working tree**: never `git stash` or `git checkout --` the `.dex/`
  directory while working, or the task list silently disappears
- `.gitattributes` unions `.dex/tasks.jsonl` on merge, so integration branches do not
  conflict on the ledger. The union splices lines silently, and task records are mutable
  (`completed`, `updated_at` are rewritten in place), so if both sides edited the same
  task the ledger ends up with two lines sharing one id. Run
  `node scripts/dex-dedupe.mjs --check` before pushing and fix any duplicate it reports
  (`node scripts/dex-dedupe.mjs` keeps the newest `updated_at` per id, then commit).
  `src/test/agent-env-guardrails.test.ts` fails CI on a duplicate id, and the `dex-ledger`
  CI job runs the same `--check`.
  `.dex/sync-state.json` is derived state with no merge attribute (`merge=ours` would be
  inert without a config-registered driver): on conflict take either side wholesale and
  delete the markers — never splice.
