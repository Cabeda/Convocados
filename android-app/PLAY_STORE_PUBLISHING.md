# Play Store Automatic Publishing

On each release (merge to main that bumps the version and touches `android-app/`),
CI takes the app through a fixed path:

1. Build **one** App Bundle and publish it to **Internal testing**.
2. Promote that same version code to **Closed testing** (`alpha`) and **Open
   testing** (`beta`) for both the phone and Wear apps.
3. Create a **production draft** for review. Production is never rolled out from
   CI — a person reviews the draft and starts a staged rollout in Play Console.

This is the "build once, promote the artifact" model: every stage gets the exact
same build, so version codes never drift and the changelog travels with it. See
[ADR 0031](../docs/adr/0031-play-track-promotion-model.md).

## Tracks

| Stage | Phone track | Wear track | Rollout |
|-------|-------------|------------|---------|
| Internal testing | `internal` | `wear:internal` | automatic |
| Closed testing | `alpha` | `wear:alpha` | automatic |
| Open testing | `beta` | `wear:beta` | automatic |
| Production | `production` | `wear:production` | draft only (manual rollout) |

"Private beta" in conversation means the **Internal testing** track — not Closed
testing.

Wear OS closed/open testing are **optional**: `wear:alpha` and `wear:beta` only
exist if you opt the Wear app into those testing tracks in Play Console. The
automated release always updates `wear:internal` and drafts `wear:production`;
the Wear closed/open promotion is best-effort and never fails the release when
those tracks are absent.

Track IDs are the Play Developer API names, which can differ from the Console
display name. This repo's Wear closed track is custom-named
**`wear:Convocados Wear`** (open testing is `wear:beta`). `List Play Tracks`
(Settings → Actions → *List Play Tracks*) prints the current IDs.

## Setup (one-time)

### 1. Create a Google Cloud Service Account

1. Google Cloud Console → IAM & Admin → Service Accounts → create one, add a JSON key.
2. Enable the [AndroidPublisher API](https://console.cloud.google.com/apis/library/androidpublisher.googleapis.com).

### 2. Grant Play Console access

Play Console → Users & permissions → invite the service account email and grant:

- **Release to testing tracks** — required for internal/closed/open.
- **Manage production releases** — required to create the production draft.
- **Manage store presence** — required for the automated screenshot upload
  (`publishReleaseListing` commits a store-listing edit; without this the
  upload fails with `403 PERMISSION_DENIED` on commit).

Apply to `com.cabeda.Convocados` (phone) and `com.cabeda.Convocados` (Wear).

### 3. Turn **Managed publishing OFF**

With managed publishing on, Play holds changes on the testing tracks too and the
automation looks like it silently did nothing. Verify this in Play Console before
relying on the pipeline.

### 4. Add GitHub secrets

| Secret | Description |
|--------|-------------|
| `PLAY_SERVICE_ACCOUNT_JSON` | Full contents of the service account JSON key |
| `GOOGLE_SERVICES_JSON` | Contents of `app/google-services.json` (Firebase config) |
| `ANDROID_KEYSTORE` | Base64-encoded release keystore (`base64 release-keystore.jks`) |
| `KEYSTORE_PASSWORD` | Keystore password |
| `KEY_ALIAS` | Key alias |
| `KEY_PASSWORD` | Key password |
| `GOOGLE_SERVER_CLIENT_ID` | Google OAuth web client ID (for Wear OS sign-in) |

### 5. Create the `production` Environment

Settings → Environments → new environment `production`, add required reviewers.
The manual remediation workflow uses it; the automated happy path does not.

## Release notes ("What's new")

Promotion copies the notes of the track it promotes **from** — always `internal`.
CI writes the GitHub Release body into:

```
android-app/app/src/main/play/release-notes/en-US/internal.txt
android-app/wear/src/main/play/release-notes/en-US/internal.txt
```

Markdown is flattened to plain text and truncated to Play's 500-character limit.
These files are static defaults in the repo; CI overwrites them only in its
ephemeral checkout and never commits the change.

## Store listing screenshots

Every release refreshes the Play Store screenshots from the committed Roborazzi
sources — no manual uploads. Source of truth:

```
app/src/test/screenshots/store-listing/{phone,foldable,tablet}/  (8 PNGs each)
wear/src/test/screenshots/store-listing/                          (4 PNGs)
```

`release.yml` runs `./gradlew syncPlayListings` (which first runs the
`generate*StoreListing` tasks: Roborazzi verification + dimension checks), then
`:app:publishListing` and `:wear:publishListing`. The publish job runs on
Java 21 — Robolectric on targetSdk 36 refuses to run on 17
(`DefaultSdkProvider` failure), which broke the first listing sync in v3.190.0.
Mapping:

| Source | Play slot |
|--------|-----------|
| `phone/` | `phone-screenshots` |
| `foldable/` | `tablet-screenshots` (7") |
| `tablet/` | `large-tablet-screenshots` (10") |
| Wear `store-listing/` | `wear-screenshots` |

The generated `src/main/play/listings/` output is gitignored — like release
notes, it exists only in the CI checkout and is never committed. Roborazzi
renders at natural device dp (e.g. 411x891 phone), but the Play images API
rejects anything with a side under 1080px (max side 7680, max aspect 2.3), so
the sync step upscales each PNG by the smallest integer factor clearing the
minimum (phone 3x to 1233x2673, foldable/tablet 2x, watch 3x to 1170x1170)
and fails the release if the result still falls outside Play's limits. Text listings
(title, descriptions) are still managed by hand in Play Console; the automation
only touches graphics. The listing upload runs **last**, after bundles,
promotions, and the production draft, so a screenshot failure never blocks a
release — it retries on the next one.

Local preview:

```bash
cd android-app
./gradlew syncPlayListings  # validates + stages graphics under src/main/play/listings/
```

Note: adaptive layout probes (`adaptive_light/dark`) are regression goldens
under `src/test/screenshots/goldens/`, not store assets — Play caps each slot
at 8 images.

## Promoting releases

### Automatic (happy path)

Runs as part of `release.yml` after the internal publish. Nothing to do.

### Manual (`Promote Play Release` workflow)

Workflow → *Promote Play Release* → **Run workflow**:

| Stage | Effect |
|-------|--------|
| `closed` | Promote `internal → alpha` (phone and/or Wear) |
| `open` | Promote `internal → beta` (phone and/or Wear) |
| `production-request` | Create a production **draft** for review |
| `remediate-production` | **Wear only.** Roll a compliant build out to `wear:production` at 100% |

`remediate-production` sits behind the `production` environment, so it requires
reviewer approval.

### Local dry run

```bash
# Place the service account JSON at android-app/play-service-account.json
cd android-app
./gradlew :app:publishReleaseBundle --validate-only
./gradlew :wear:publishReleaseBundle --validate-only
```

## Recovering from a policy rejection

Play's remediation steps, mapped to this pipeline:

1. Fix the policy issue and release a new version (it lands on `internal`
   automatically).
2. Replace the violating build on every track it reached. The automated release
   already promotes to `alpha`/`beta`; run *Promote Play Release* with
   `remediate-production` to roll out `wear:production` at 100%.
3. In Play Console, discard or update any draft release that still references the
   non-compliant bundle so it does not remain under "Not included".
4. If the region/track opt-in itself is the problem, disable the Wear OS release
   type under Advanced settings → Release types.
