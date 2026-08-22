# 0022 — PR preview environments on Fly.io

**Status:** Accepted
**Date:** 2026-08-22

## Context

The web app deploys to Fly.io (`convocados`) only on release tags. Testing a PR
means running the dev server locally, which hides integration issues that only
appear in a deployed environment (migrations against a fresh volume, health
checks, reverse-proxy behaviour, production builds). Vercel-style "deploy
previews for every PR" would fix this, but the repo is open source: any fork
author can open a PR, so an auto-deploy-on-push pipeline would let arbitrary
internet strangers consume paid infrastructure and reach deploy secrets.

## Decision

### 1. Opt-in per PR via comment commands

Previews are **manual**: `/preview` on a PR comment deploys the current PR head
to `https://convocados-pr-<N>.fly.dev`; `/preview-stop` tears it down early;
closing the PR always destroys it. Pushes never trigger deployments, so idle
PRs cost nothing.

### 2. Strict allowlist gate

The entry workflow runs on `pull_request_target` / `issue_comment` (base-repo
context, secrets available). Before anything is deployed, both the **PR author
and the commenter** must pass one gate: repository-owner association, or a
username listed in `.github/CODEOWNERS` (usernames only — teams and emails are
not resolved). This file doubles as the normal code-owners mapping; adding a
contributor there grants them preview access. The shared gate logic lives in
`.github/scripts/preview-authorize.sh`.

Deployment is delegated to `preview-deploy.yml` via `repository_dispatch` — a
trusted-actor event that never carries attacker-controlled context — and the
worker **re-runs the same allowlist gate** against fresh CODEOWNERS before
fetching untrusted PR code. Keeping privileged event triggers and the
untrusted checkout in separate workflow definitions also satisfies CodeQL's
`actions/untrusted-checkout` query by construction rather than suppression.

### 3. Cheapest viable machine shape

Each preview is its own Fly app with:

- **256mb shared-cpu-1x** machine — previews serve a single reviewer.
- **No persistent volume**: SQLite lives on machine-local ephemeral disk. The
  dedicated `.fly/preview.toml` drops `release_command` (its throwaway release
  machine would discard DB writes without a volume) and relies on
  `scripts/start.sh`, which already runs `prisma migrate deploy` on boot.
- `min_machines_running = 0` + `auto_stop_machines = suspend`: zero compute
  cost while idle.
- Preview data starts empty (schema from migrations). Prod data is never
  copied into previews — no PII leaks into long-lived environments.

### 4. Secret isolation

Previews use a dedicated `FLY_PREVIEW_TOKEN` (separate from the prod deploy
token) and a shared static `PREVIEW_BETTER_AUTH_SECRET` staged onto each app.
No production secrets ever reach a preview app or the workflow's deploy step.

## Considered Options

- **Auto-deploy on every push** (classic review apps) — rejected: burns
  resources for unrequested work and widens the abuse surface on an open-source
  repo where anyone can open PRs.
- **Two-workflow split** (`pull_request` build + gated deploy) — rejected:
  more moving parts for the same guarantee; the authorize-gate-first pattern
  inside one workflow is simpler to audit.
- **Fly Sprites** (https://sprites.dev) as cheaper sandboxes — rejected: no
  public HTTPS ingress (WebSocket TCP-proxy tunnels only), no OCI-image deploy
  primitive. A reviewer needs a plain browsable URL; bridging sprites to one
  adds a relay hop and third-party dependency that outweighs the savings.
- **Persistent 1GB volumes per preview** — rejected: $0.15/GB/mo each, slower
  first deploy (volume creation), extra teardown step, and durable storage has
  no value for disposable test data.

## Consequences

- Contributors in CODEOWNERS get self-service preview URLs within minutes of
  typing `/preview`.
- Preview databases are wiped if Fly reclaims the host — acceptable by design;
  treat preview data as ephemeral (stated in every preview comment).
- Orphaned apps are possible if a run crashes between create and close-event
  cleanup; a periodic sweep is tracked separately.
- Machine sizing (256mb) may need bumping to 512mb if health checks flake under
  load; change lives in `.fly/preview.toml`.
