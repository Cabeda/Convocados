# Mobile App

Convocados has a native Android app built with Kotlin and Jetpack Compose. It connects to any self-hosted Convocados instance via OAuth 2.1 + PKCE.

## Features

- View and manage your upcoming games
- Join/leave events, add guest players
- Team randomization with VS display
- Player stats and ELO rankings
- Push notifications via Firebase Cloud Messaging (FCM)
- Multi-language: English, Português, Español, Français, Deutsch, Italiano
- Configurable server URL — connect to any Convocados instance

## Authentication

The app authenticates via the Convocados OIDC provider using Authorization Code + PKCE. Tokens are stored securely using Android's EncryptedSharedPreferences.

The server must have the app's redirect URI registered as a trusted client:

```bash
TRUSTED_OAUTH_CLIENT_ID=convocados-android
TRUSTED_OAUTH_CLIENT_SECRET=<secret>
TRUSTED_OAUTH_REDIRECT_URIS=convocados://callback
```

## Development setup

```bash
cd android-app
./gradlew assembleDebug    # Build debug APK
./gradlew installDebug     # Install on connected device / emulator
```

## Push notifications

Push notifications use Firebase Cloud Messaging (FCM) HTTP v1 API.

### Required setup

1. Create a Firebase project and download `google-services.json`
2. Place it at `android-app/app/google-services.json`
3. Set the `GOOGLE_SERVICE_ACCOUNT_JSON` environment variable on the server with your Firebase service account credentials

## Project structure

```
android-app/
├── app/src/main/java/dev/convocados/
│   ├── data/
│   │   ├── api/          # API client, models
│   │   ├── auth/         # OAuth + token storage
│   │   ├── datastore/    # Settings persistence
│   │   └── push/         # FCM service + token manager
│   └── ui/
│       ├── navigation/   # App navigation routes
│       ├── screen/       # All app screens
│       └── theme/        # Material 3 theme
├── build.gradle.kts
└── settings.gradle.kts
```

## Building a release APK

Release APKs are built automatically by the CI/CD pipeline on every release. To build locally:

```bash
cd android-app
./gradlew assembleRelease
```

The unsigned APK will be at `app/build/outputs/apk/release/`.
