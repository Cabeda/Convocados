# Mobile Apps

Convocados has native apps for Android and iOS. Both connect to any self-hosted Convocados instance.

## Android

Native Android app built with Kotlin and Jetpack Compose (Material 3). Available now on the Google Play Store.

- **Play Store:** https://play.google.com/store/apps/details?id=com.cabeda.Convocados
- **Auth:** Convocados OIDC provider (Authorization Code + PKCE via Custom Tabs)
- **Push:** Firebase Cloud Messaging (FCM)

### Help us test

Want to try new features before everyone else? Join the [testing track](https://play.google.com/apps/testing/com.cabeda.Convocados) to get early builds straight from the Play Store.

Keep in mind:

- Early builds **may include breaking changes** — data or settings could reset between updates.
- We rely on your feedback: report bugs and share suggestions on [GitHub Issues](https://github.com/Cabeda/Convocados/issues) or start a conversation on [GitHub Discussions](https://github.com/Cabeda/Convocados/discussions).

### Features

- View and manage your upcoming games
- Join/leave events, add guest players
- Team randomization with standings
- Player stats and ELO rankings
- Push notifications via FCM
- Multi-language: English, Português, Español, Français, Deutsch, Italiano
- Configurable server URL — connect to any Convocados instance

### Development setup

```bash
cd android-app
./gradlew assembleDebug    # Build debug APK
./gradlew installDebug     # Install on connected device / emulator
```

### Push notifications

Push notifications use Firebase Cloud Messaging (FCM) HTTP v1 API.

1. Create a Firebase project and download `google-services.json`
2. Place it at `android-app/app/google-services.json`
3. Set the `GOOGLE_SERVICE_ACCOUNT_JSON` environment variable on the server with your Firebase service account credentials

### Project structure

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

### Building a release APK

Release APKs are built automatically by the CI/CD pipeline on every release. To build locally:

```bash
cd android-app
./gradlew assembleRelease
```

The unsigned APK will be at `app/build/outputs/apk/release/`.

## iOS

Native iOS app built with SwiftUI (MVVM, zero third-party dependencies). Under development and **awaiting funding**.

- **Funding:** https://ko-fi.com/cabeda/goal?g=20 — one-time campaign to cover the $100 Apple Developer Program membership
- **Recurring support:** https://github.com/sponsors/Cabeda
- **Auth:** email/password and Google sign-in via `/api/auth/mobile-native`; tokens stored in Keychain
- **Status:** builds and runs on the iOS Simulator; same feature set as Android

### Development setup

```bash
cd ios-app
xcodegen generate          # Regenerate the Xcode project (requires xcodegen)
open Convocados.xcodeproj  # Build & run in Xcode — simulator works out of the box
```

### E2E tests

`ios-app/ConvocadosUITests` (XCUITest) drives the app on the simulator against a local dev server: sign in, create a game, open it.

```bash
cd ios-app
./scripts/run-e2e.sh
```

### Project structure

```
ios-app/
├── Convocados/            # App source
│   ├── App/               # SwiftUI entry, root wiring
│   ├── Data/              # API client, auth, push, settings
│   ├── UI/                # Screens, components, theme
│   └── Resources/         # Info.plist, entitlements, assets
├── ConvocadosUITests/     # XCUITest end-to-end suite
├── project.yml            # xcodegen project definition
└── scripts/run-e2e.sh     # E2E test runner
```

### Authentication

The app authenticates via `/api/auth/mobile-native` (email/password or Google sign-in) and refreshes tokens through the
same endpoint's `refresh` action. Tokens are stored in the iOS Keychain.
