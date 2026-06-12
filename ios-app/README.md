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

## Architecture

- **MVVM** with ObservableObject ViewModels
- **URLSession + async/await** networking
- **Keychain** token storage (Security framework, no third-party deps)
- **ASWebAuthenticationSession** for OAuth 2.1 PKCE
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

- OAuth 2.1 login (PKCE via Custom Tabs equivalent)
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
