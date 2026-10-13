# Coding Standards

`AGENTS.md` carries the mission, the gates, and the conventions a linter or a config already
enforces. This file carries the rest: the standards a **reviewer** enforces that no tool
can, reached because Code Style points here during review — not during implementation.

Each section names the failure it replaces. Where a check could ever be mechanical, the
standard says so and names the check; the rest is judgement, which is why it lives here.

## Wear OS: round vs square is a first-class layout axis

A row authored for round geometry is wrong on square, and vice versa. The failure mode this
replaces: someone adds `Modifier.roundListInset()` or a `maxLines`/`TextOverflow.Ellipsis`
pair to fix clipping on round and silently clips square displays, where the old padding was
harmless.

- Every width-constrained row gets its inset from `RoundSafeLayout` (`roundListInset()`,
  `roundSafeWidth()`), never a hand-written `padding(horizontal = ...)` — round only.
- Any `maxLines`/`TextOverflow.Ellipsis` added to a row that fills the display must be
  **round-aware**: ellipsize inside the safe band on round, keep the square display's
  previous behaviour otherwise. A square leg in the test (≥85% fill, no clipping) is the
  only proof.
- Screens get their Robolectric test from the `TeamsScreenRoundSafeTest` model: an anchor
  row that itself asserts it is inset by at least `ROUND_LIST_INSET`, then every fixed row
  compared against that anchor. The anchor guard is what stops the assertion from silently
  weakening — keep it when extracting helpers.

## Wear UI: verify on round **and** square before shipping

The round/square axis above is about *authoring*; this is about *proving* the result. The
failure this replaces: a fix verified only on round — or trusted to a green
`verifyRoborazziDebug` — that silently no-ops or clips on the other shape.

- Check the change on **both** a round and a square display. `./gradlew
  :wear:recordRoborazziDebug` regenerates the goldens; then **open and look at** the
  `round_*` and `square_*` PNGs in `wear/src/test/screenshots/shapes/`. A green
  `verifyRoborazziDebug` only proves the render did not change — not that it is right.
- Include the small-round case: configuration `w227dp-h227dp-round` (goldens
  `small_round_*`), where a flat inset costs the most width and controls clip first.
- Where a watch is reachable, install the **release** APK (`:wear:assembleRelease`,
  signed by `keystore.properties`) rather than debug — debug is too slow to judge motion
  and interaction.

## A layout modifier may not read back what it wrote

A Wear modifier that derives its layout from `onGloballyPositioned` is reviewed for a
**settle loop**: the state it writes must not be a function of the layout that state
produces. The failure this replaces is silent and expensive — `inset -> width -> text wrap
-> height -> bottom edge -> inset` never converged, and `waitForIdle` polled for sixty
seconds before timing out, with no assertion pointing at the cause.

- Vertical bounds are the hazard. Horizontal padding does not change a row's height, so a
  width-only inset is safe; anything that reads the bottom edge feeds back through wrapping.
- Accept an update only in a direction that does not feed back. Growth is monotone and
  bounded by the touch-target floor, so it settles; a shrink re-opens the cycle.
- Measure it: the suite time is the tell. A round-safe suite that jumps from seconds to a
  timeout is a loop, not a slow machine.

## Test fixtures and scaffolding live in the test source set

`android-app/wear/src/test`, `src/test`. The failure this replaces: a composable that only
tests consume ends up in `src/main` exporting public tags, and production code inherits a
test surface.

- Anchors, fixtures and reference rows used only by tests belong in the test source set;
  production keeps its `testTag` literals private (GamesScreen/TeamsScreen convention).
- When the same Robolectric assertion scaffolding appears in sibling test files, extract
  one shared helper seeded from the anchor pattern above rather than copy-pasting a third
  time. Duplicated scaffolding drifts; the drift is always in the direction of a weaker
  assertion.

## Reviewer checklist (the mechanical ones)

- New mutation routes: validate input early, apply rate limiting, return a specific status
  for "not allowed" (403) vs "not allowed yet" (409).
- Schema/migration pairs: `prisma migrate diff --from-migrations prisma/migrations
  --to-schema prisma/schema.prisma --exit-code` must print "No difference detected." —
  drift here regenerates a table rebuild on every future `migrate dev`. (`--to-schema` is
  the flag this Prisma version ships; the older `--to-schema-datamodel` errors out.)
- Coverage and audit thresholds move up only; an exemption in
  `pnpm-workspace.yaml#auditConfig.ignoreGhsas` names the GHSA ids, the reason, and a
  re-review date — verified by deriving the advisory set from `pnpm audit --json`, never
  by trusting a named-only list.
- A feature that ships on web ships on Android in the same change
  (`pnpm sync:feature-parity-docs` is the check, not the exception).
