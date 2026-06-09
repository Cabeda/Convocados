# Play Store Automatic Publishing

On each release (merge to main that bumps the version), the CI automatically publishes AABs to the Play Store **internal testing** track.

## Setup (one-time)

### 1. Create a Google Cloud Service Account

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → IAM & Admin → Service Accounts
2. Create a service account (e.g., `play-publisher@your-project.iam.gserviceaccount.com`)
3. Create a JSON key and download it

### 2. Grant Play Console Access

1. Go to [Play Console](https://play.google.com/console) → Users & permissions → Invite new users
2. Add the service account email
3. Grant permissions:
   - **Release to testing tracks** (for internal/alpha/beta)
   - **Manage production releases** (if you want to promote later)
4. Apply to the specific app(s): `com.cabeda.Convocados` and `com.cabeda.Convocados` (Wear)

### 3. Add GitHub Secrets

Add these secrets to the repository (Settings → Secrets and variables → Actions):

| Secret | Description |
|--------|-------------|
| `PLAY_SERVICE_ACCOUNT_JSON` | Full contents of the service account JSON key file |
| `GOOGLE_SERVICES_JSON` | Contents of `app/google-services.json` (Firebase config) |
| `ANDROID_KEYSTORE` | Base64-encoded release keystore (`base64 release-keystore.jks`) |
| `KEYSTORE_PASSWORD` | Keystore password |
| `KEY_ALIAS` | Key alias |
| `KEY_PASSWORD` | Key password |
| `GOOGLE_SERVER_CLIENT_ID` | Google OAuth web client ID (for Wear OS sign-in) |

### 4. Local testing (optional)

To test publishing locally:

```bash
# Place your service account JSON at:
android-app/play-service-account.json

# Dry run (validates without uploading):
cd android-app
./gradlew :app:publishReleaseBundle --validate-only
./gradlew :wear:publishReleaseBundle --validate-only
```

## How it works

- Plugin: [gradle-play-publisher](https://github.com/Triple-T/gradle-play-publisher) (v3.12.1)
- Phone app → `internal` track
- Wear OS app → `wear:internal` track
- Release notes: `{module}/src/main/play/release-notes/en-US/internal.txt`
- Version code: auto-generated from timestamp (already configured)

## Promoting releases

After testing internally, promote to production via Play Console UI or:

```bash
./gradlew :app:promoteArtifact --from-track internal --promote-track production
```
