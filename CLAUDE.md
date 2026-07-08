# Project Instructions for AI Agents

This file provides instructions and context for AI coding agents working on this project.

<!-- Issue tracking uses dex — see AGENTS.md for full workflow -->
## Issue Tracker (dex)

This project uses **[dex](https://dex.rip)** for issue tracking. Run `dex --help` for the CLI.

### Quick Reference

```bash
dex ready              # Find available work
dex show <id>          # View issue details
dex start <id>         # Claim work
dex complete <id>      # Complete work
dex sync               # Push tasks to GitHub Issues
```

### Rules

- Use `dex` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- GitHub sync is enabled with `on_change = true` (auto-sync on every mutation)
- Tasks are stored at `.dex/tasks.jsonl` (committed to repo) and synced to GitHub Issues

## Session Completion

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until the PR is created and pushed.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - `dex create "..."` for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - `dex complete` finished work, `dex start` in-progress items
4. **Create PR and push branch** - This is MANDATORY
5. **Wait for CI** - Check `gh pr checks <number>` passes
6. **Clean up** - Clear stashes, prune remote branches
7. **Verify** - Branch pushed, PR created, CI green
8. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- NEVER push directly to `main` — always use a PR
- Work is NOT complete until the PR is created and pushed to the remote
- NEVER stop before pushing the branch — that leaves work stranded locally
- NEVER say "ready to push when you are" — YOU must push the branch and create the PR
- If push fails, resolve and retry until it succeeds
- Only merge when the user explicitly asks to merge


## Build & Test

_Add your build and test commands here_

```bash
# Example:
# npm install
# npm test
```

## Architecture Overview

_Add a brief overview of your project architecture_

## Conventions & Patterns

_Add your project-specific conventions here_
