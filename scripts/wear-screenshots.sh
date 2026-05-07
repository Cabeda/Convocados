#!/usr/bin/env bash
# scripts/wear-screenshots.sh
# Wear OS screenshot generation
#
# Two approaches:
#
# 1. PREVIEW SCREENSHOTS (recommended, no emulator needed):
#    Open android-app/wear/src/main/java/dev/convocados/wear/ui/preview/ScreenPreviews.kt
#    in Android Studio, then use the Compose Preview panel to capture images.
#
# 2. EMULATOR SCREENSHOTS (requires running emulator + manual sign-in):
#    This script boots the emulator and captures the auth screen automatically.
#    For authenticated screens, sign in manually via the watch UI first.
#
# Prerequisites:
#   - Android SDK with emulator
#   - Wear_OS_Large_Round AVD
#   - JAVA_HOME set (or Android Studio installed)
#
# Usage:
#   ./scripts/wear-screenshots.sh

set -euo pipefail

ANDROID_SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
JAVA_HOME="${JAVA_HOME:-/Applications/Android Studio.app/Contents/jbr/Contents/Home}"
export JAVA_HOME ANDROID_HOME="$ANDROID_SDK"

ADB="$ANDROID_SDK/platform-tools/adb"
EMULATOR="$ANDROID_SDK/emulator/emulator"
AVD="${WEAR_AVD:-Wear_OS_Large_Round}"
OUTPUT_DIR="docs/screenshots/wear"
PACKAGE="com.cabeda.Convocados"
ACTIVITY="dev.convocados.wear.ui.WearActivity"

mkdir -p "$OUTPUT_DIR"

echo "=== Wear OS Screenshot Generator ==="

# Start emulator if not running
SERIAL=""
if "$ADB" devices 2>/dev/null | grep -q "emulator-"; then
  SERIAL=$("$ADB" devices | grep "emulator-" | head -1 | awk '{print $1}')
  echo "✓ Emulator already running: $SERIAL"
else
  echo "→ Starting Wear OS emulator ($AVD)..."
  "$EMULATOR" -avd "$AVD" -no-audio -no-window -gpu swiftshader_indirect &
  "$ADB" wait-for-device
  SERIAL="emulator-5554"
  while [ "$("$ADB" -s $SERIAL shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" != "1" ]; do
    sleep 3
  done
  sleep 8
  echo "✓ Emulator ready"
fi

A="$ADB -s $SERIAL"

# Build and install
echo "→ Building Wear OS debug APK..."
(cd android-app && ./gradlew :wear:assembleDebug --quiet 2>/dev/null) || echo "  (build skipped — using existing APK)"
APK="android-app/wear/build/outputs/apk/debug/wear-debug.apk"
if [ -f "$APK" ]; then
  echo "→ Installing..."
  $A install -r "$APK" 2>&1 | tail -1
fi

# Capture auth screen
echo "→ Capturing auth screen..."
$A shell pm clear "$PACKAGE" 2>/dev/null || true
sleep 2
$A shell am start -n "$PACKAGE/$ACTIVITY"
sleep 5
$A shell screencap -p /sdcard/wear_auth.png
$A pull /sdcard/wear_auth.png "$OUTPUT_DIR/01-auth.png"
$A shell rm /sdcard/wear_auth.png
echo "  ✓ $OUTPUT_DIR/01-auth.png"

echo ""
echo "=== Auth screen captured ==="
echo ""
echo "For authenticated screenshots (games, score, teams):"
echo "  1. Sign in manually on the watch (Google Sign-In or email)"
echo "  2. Then run:"
echo "     $ADB -s $SERIAL shell screencap -p /sdcard/screenshot.png"
echo "     $ADB -s $SERIAL pull /sdcard/screenshot.png $OUTPUT_DIR/02-games.png"
echo ""
echo "Or use Compose Previews in Android Studio:"
echo "  Open: android-app/wear/src/main/java/dev/convocados/wear/ui/preview/ScreenPreviews.kt"
echo ""
ls -la "$OUTPUT_DIR/"
