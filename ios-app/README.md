# Convocados iOS App

Native SwiftUI app with full feature parity with the Android app, targeting EU alternative app stores (AltStore / Aptoide iOS).

## Requirements

- Xcode 16+ (or Xcode Command Line Tools with iOS SDK)
- iOS 16.0+ deployment target
- Swift 6.0

## Building

```bash
cd ios-app

# Generate the Xcode project (requires xcodegen: brew install xcodegen)
xcodegen generate

# Open in Xcode
open Convocados.xcodeproj

# Or build from command line
xcodebuild -project Convocados.xcodeproj -scheme Convocados -sdk iphoneos -configuration Release
```

## E2E Tests

`ConvocadosUITests` (XCUITest) drives the app on the simulator end-to-end against a
local dev server: sign in → create a game → open it. Run it with:

```bash
cd ios-app
./scripts/run-e2e.sh
```

The test launches the app with `-serverUrl http://localhost:4321`, so the host's
`npm run dev` must be running (the simulator shares the host loopback).

Prerequisites for a clean run:
1. A verified test user. Default is `ios@test.com` / `TestPassword123`. To create
   one locally:
   ```bash
   curl -X POST http://localhost:4321/api/auth/mobile-native \
     -H 'Content-Type: application/json' \
     -d '{"action":"email-signup","email":"ios@test.com","password":"TestPassword123","name":"iOS Test"}'
   # then verify the email:
   sqlite3 dev.db "UPDATE User SET emailVerified=1 WHERE email='ios@test.com';"
   ```
2. The `convocados-mobile-app` row must exist in `oauthClient` (mobile-native login
   and refresh depend on it):
   ```sql
   INSERT INTO oauthClient (id, clientId, clientSecret, disabled, skipConsent, redirectUris, tokenEndpointAuthMethod, type, public, grantTypes, responseTypes, scopes, createdAt, updatedAt)
   VALUES ('convocados-mobile-app','convocados-mobile-app',NULL,0,1,
     '["convocados://auth","convocados://redirect","convocados://auth/callback"]',
     'none','mobile',1,'["authorization_code","refresh_token"]','["code"]',
     'openid profile email offline_access read:events write:events manage:players read:ratings read:history manage:teams manage:push',
     datetime('now'), datetime('now'));
   ```

## Architecture

- **MVVM** with ObservableObject ViewModels
- **URLSession + async/await** networking
- **Keychain** token storage (Security framework, no third-party deps)
- **URLSession email/password auth** via `/api/auth/mobile-native` (mirrors Android)
- **NavigationStack** with typed routes
- **Zero third-party dependencies** — only system frameworks

## EU Alt Store Distribution

This app is designed for distribution via AltStore or Aptoide iOS (EU DMA marketplaces):

1. **No App Store entitlements needed** — signed with a development or ad-hoc profile
2. **No Apple IAP restrictions** — direct payments allowed
3. **IPA export**: Archive → Export (Ad Hoc) → distribute .ipa to alt store

### Exporting for AltStore

```bash
xcodebuild archive \
  -project Convocados.xcodeproj \
  -scheme Convocados \
  -sdk iphoneos \
  -archivePath build/Convocados.xcarchive

xcodebuild -exportArchive \
  -archivePath build/Convocados.xcarchive \
  -exportPath build/ipa \
  -exportOptionsPlist ExportOptions.plist
```

### ExportOptions.plist for ad-hoc

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>method</key>
    <string>ad-hoc</string>
    <key>compileBitcode</key>
    <false/>
</dict>
</plist>
```

## Features (full Android parity)

- Email/password login (via `/api/auth/mobile-native`, Android parity)
- Games list with tabs (My Games / Archived / Public)
- Event detail: header, teams, players, quick-join, add from contacts
- Create event with sport presets + recurring
- Team creation (balanced / random)
- Rankings / ELO
- Payments tracking
- Push notifications (APNs → server token sync)
- Profile: theme, language, server URL, logout
- Contact picker (CNContactPicker) for add-by-email invite
- Deep linking (convocados:// scheme + universal links)

## Design

- SF Symbols for all icons
- Dynamic Type support (system font scales)
- System colors (auto light/dark adaptation)
- Pull-to-refresh, swipe actions, searchable
- Large title navigation bars
- iPad + landscape support
