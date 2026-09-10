# 0031 — Play release stages via track promotion

**Status:** Accepted
**Date:** 2026-09-10

## Context

Google Play exposes release stages as tracks: `internal`, `alpha` (Closed
testing), `beta` (Open testing), `production`. The Wear app uses the dedicated
form-factor tracks (`wear:internal`, `wear:alpha`, `wear:beta`,
`wear:production`) because it is distributed as a Wear OS app. In conversation
"private beta" means the `internal` track; the app's automated entry point is
`internal`.

The release workflow already built an AAB and uploaded it to `internal`. A Play
policy rejection then showed the cost of the alternative: the non-compliant
build had propagated across several tracks, and there was no first-class way to
push a single compliant build to all of them. A single developer needs a
release model that is correct, auditable, and easy to test without maintaining
a staging environment.

## Decision

1. **Build once, promote the artifact.** Each release builds one App Bundle and
   uploads it to `internal` only. Every later stage moves that same version code
   with Gradle Play Publisher's `promoteReleaseArtifact`; no stage rebuilds, so
   the version code never drifts between tracks.
2. **Testing tracks are automatic.** On release, CI promotes the internal build
   to Closed testing and Open testing for both phone and Wear. `completed`
   status means the testing rollout is not staged.
3. **Production is human-gated.** CI only creates a production **draft** for
   both apps. A person reviews it in Play Console and starts a staged rollout
   (10% first). Production never goes live hands-free.
4. **Release notes travel with the promotion.** Promotion copies the notes of
   the track it promotes *from*; CI writes the GitHub Release body into
   `release-notes/<lang>/internal.txt` (plain text, ≤500 characters) before
   promoting, so every stage carries the same changelog. The Play release name
   is the release tag.
5. **Remediation is a first-class manual operation.** A policy violation is
   fixed by shipping a new compliant version code to `internal`, then running
   the manual **Promote Play Release** workflow's `remediate-production` stage,
   which rolls the Wear build out to `wear:production` at 100% and replaces the
   violating bundle. That stage sits behind the `production` GitHub Environment
   (required reviewers). The same workflow back-fills a skipped track.
6. **The service account has both scopes.** "Release to testing tracks" and
   "Manage production releases". **Managed publishing is off**, otherwise Play
   holds testing-track changes and the automation appears to do nothing.

## Consequences

- A release is one artifact with one changelog, promoted along a fixed,
  inspectable path; the only manual step that reaches users is the production
  rollout.
- The release-notes files are static defaults in the repo. CI overwrites them
  only in its ephemeral checkout and never commits the change, so the committed
  copies and the GitHub Release body remain the source of truth.
- Creating a production draft on every release can accumulate drafts if a
  previously drafted release is neither rolled out nor discarded; a draft must
  be cleared in Play Console as part of the review step.
- The Wear-only remediation path exists because the phone app shares none of
  the Wear quality policy surface; promoting the phone app into a fresh review
  as collateral is avoided.

## Alternatives considered

- **Rebuild per track.** Rejected: independent builds produce independent
  version codes, and Play rejects an upload whose version code is not strictly
  greater, so tracks would stop being comparable.
- **Fastlane `supply`.** Rejected: adds a second release toolchain next to
  Gradle Play Publisher, which is already wired in.
- **Direct Play Developer API scripts.** Rejected: more surface to maintain for
  the same operations GPP already exposes (`--promote-track`,
  `--release-status`).
