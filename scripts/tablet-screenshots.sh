#!/usr/bin/env bash
# scripts/tablet-screenshots.sh
# Generate Play Store screenshots for 7-inch and 10-inch tablets.
#
# Usage:
#   ./scripts/tablet-screenshots.sh [7|10|all]

set -euo pipefail

ANDROID_SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
JAVA_HOME="${JAVA_HOME:-/Applications/Android Studio.app/Contents/jbr/Contents/Home}"
export JAVA_HOME ANDROID_HOME="$ANDROID_SDK"

ADB="$ANDROID_SDK/platform-tools/adb"
EMULATOR="$ANDROID_SDK/emulator/emulator"
PACKAGE="com.cabeda.Convocados"
ACTIVITY="dev.convocados.MainActivity"
TARGET="${1:-all}"

take_screenshot() {
  local serial="$1" name="$2" output_dir="$3" delay="${4:-3}"
  sleep "$delay"
  "$ADB" -s "$serial" shell screencap -p "/sdcard/$name.png"
  "$ADB" -s "$serial" pull "/sdcard/$name.png" "$output_dir/$name.png" 2>&1 | tail -1
  "$ADB" -s "$serial" shell rm "/sdcard/$name.png"
  echo "  ✓ $output_dir/$name.png"
}

run_tablet() {
  local avd="$1" size="$2"
  local output_dir="docs/screenshots/tablet-${size}inch"
  local serial=""

  mkdir -p "$output_dir"
  echo ""
  echo "=== ${size}-inch Tablet ($avd) ==="

  # Start emulator
  echo "→ Starting emulator..."
  "$EMULATOR" -avd "$avd" -no-audio -no-window -gpu swiftshader_indirect -no-snapshot-load &
  local emu_pid=$!

  # Wait for device
  "$ADB" wait-for-device
  serial=$("$ADB" devices | grep "emulator-" | head -1 | awk '{print $1}')

  echo "→ Waiting for boot ($serial)..."
  while [ "$("$ADB" -s "$serial" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" != "1" ]; do
    sleep 3
  done
  sleep 8
  echo "✓ Emulator ready"

  # Install APK
  local apk="android-app/app/build/outputs/apk/debug/app-debug.apk"
  if [ ! -f "$apk" ]; then
    echo "→ Building APK..."
    (cd android-app && ./gradlew :app:assembleDebug --quiet)
  fi
  echo "→ Installing app..."
  "$ADB" -s "$serial" install -r "$apk" 2>&1 | tail -1

  # Grant permissions
  "$ADB" -s "$serial" shell pm grant "$PACKAGE" android.permission.POST_NOTIFICATIONS 2>/dev/null || true

  # Launch app
  echo "→ Launching app..."
  "$ADB" -s "$serial" shell am start -n "$PACKAGE/$ACTIVITY"
  take_screenshot "$serial" "01-landing" "$output_dir" 6

  # Navigate within the app - tap around to show different screens
  # Scroll down on landing page
  "$ADB" -s "$serial" shell input swipe 600 1400 600 600 500
  take_screenshot "$serial" "02-features" "$output_dir" 3

  echo "→ Stopping emulator..."
  "$ADB" -s "$serial" emu kill 2>/dev/null || kill "$emu_pid" 2>/dev/null || true
  wait "$emu_pid" 2>/dev/null || true

  echo "✓ ${size}-inch screenshots saved to $output_dir/"
  ls "$output_dir/"
}

echo "=== Tablet Screenshot Generator ==="

case "$TARGET" in
  7)   run_tablet "tablet_7inch" "7" ;;
  10)  run_tablet "tablet_10inch" "10" ;;
  all)
    run_tablet "tablet_7inch" "7"
    run_tablet "tablet_10inch" "10"
    ;;
  *)   echo "Usage: $0 [7|10|all]"; exit 1 ;;
esac
