# ADR 0037 — CI owns the README screenshots

Status: accepted (2026-09-18)

## Context

The README embeds thirteen committed images from `docs/screenshots/web/`
(landing, dashboard, event pages, public games, …). They were captured by hand,
so they drift silently: the newest was months old before this decision, and
there is no script that reproduces them. The `scripts/screenshots.ts` pipeline
writes to a **gitignored** `screenshots/` directory for the AI UI-review flow —
a different output contract, not the README assets.

The obvious fix — "a CI job that regenerates them" — runs into a protected
`main` (AGENTS.md forbids direct pushes) and into reproducibility: a screenshot
bot only converges if two runs produce byte-identical images. Seed data was
random (`faker`, `Math.random`) and all dates were wall-clock relative, so no
two runs agreed.

## Decision

**A non-required GitHub Actions workflow owns `docs/screenshots/web/`.**

- `.github/workflows/screenshots.yml` runs on PRs that touch `src/**`,
  `prisma/seed-screenshots.ts`, or `scripts/screenshots/**`. It is deliberately
  **not** part of the required `CI` gate, so image churn can never block a merge.
- It builds the app, seeds a **deterministic fixture**
  (`prisma/seed-screenshots.ts`, all IDs/dates/values fixed), starts the server,
  and runs `pnpm screenshots:readme`.
- Capture is deterministic: a **frozen instant** (`CONVOCADOS_FIXED_NOW`,
  default `2026-03-14T18:00:00.000Z`) shared by the seed, the server clock, and
  Playwright; pinned viewport (1512×810 @2x), locale, timezone, reduced motion,
  animations disabled, seeded `Math.random`, and neutralized PWA/service-worker
  surfaces.
- The server reads time through `src/lib/now.ts`, which honors
  `CONVOCADOS_FIXED_NOW`. Only the read paths that compare against "now" use the
  seam (event GET's lazy-recurrence guard, post-game status, game status), so the
  server and the browser agree on the instant without a repo-wide refactor.
- If the regenerated files differ, the job commits them **back to the same-repo
  PR branch** (new commit, `docs/screenshots/web` pathspec only, App/PAT token so
  downstream checks re-run). Fork PRs cannot be written to, so they receive the
  images as a build artifact plus a PR comment.
- Capture is all-or-nothing into a temp directory; a partial run never publishes.
- The dead README badge (`ci.yml` → `test.yml`) is fixed in the same change.

## Consequences

- Contributing a UI change no longer requires hand-capturing screenshots; the
  bot updates them on the PR. A second same-day run finds no diff and stops,
  which is what makes the loop terminate.
- The fixture seed is throwaway and separate from `prisma/seed.ts`; the dev seed
  keeps its randomness.
- `docs/screenshots/mobile/` (native Android) is out of scope: it needs an
  emulator and overlaps the existing Roborazzi golden work.
- The frozen instant is a constant. If a future screenshot must show a
  realistic "today", bump `CONVOCADOS_FIXED_NOW` in the workflow (and the seed
  derives everything from it).
- A missing `SCREENSHOT_BOT_TOKEN` degrades gracefully: the job still captures
  and uploads, it just cannot commit.
