#!/usr/bin/env bash
# Launch phone + watch emulators, sign in, and deploy the Convocados app.
# Usage: ./scripts/run-emulators.sh [--deploy] [--kill]
set -euo pipefail

SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
ADB="$SDK/platform-tools/adb"
EMU="$SDK/emulator/emulator"
JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home}"
export JAVA_HOME

PHONE_AVD="Pixel7a"
WATCH_AVD="WearOS5"
PHONE_PORT=5554
WATCH_PORT=5556
PHONE_SERIAL="emulator-$PHONE_PORT"
WATCH_SERIAL="emulator-$WATCH_PORT"

DEPLOY=false
KILL=false
for arg in "$@"; do
  case $arg in
    --deploy) DEPLOY=true ;;
    --kill)   KILL=true ;;
  esac
done

if $KILL; then
  echo "Killing emulators..."
  pkill -f "qemu-system" 2>/dev/null || true
  $ADB kill-server 2>/dev/null || true
  echo "Done."
  exit 0
fi

# --- Launch emulators ---
launch_emu() {
  local avd=$1 port=$2 label=$3
  if $ADB -s "emulator-$port" get-state 2>/dev/null | grep -q device; then
    echo "$label already running on emulator-$port"
    return
  fi
  echo "Starting $label ($avd) on port $port..."
  nohup "$EMU" -avd "$avd" -port "$port" > "/tmp/emu-${label}.log" 2>&1 &
}

$ADB start-server
launch_emu "$PHONE_AVD" "$PHONE_PORT" "phone"
launch_emu "$WATCH_AVD" "$WATCH_PORT" "watch"

# --- Wait for boot ---
wait_boot() {
  local serial=$1 label=$2
  echo -n "Waiting for $label to boot..."
  for i in $(seq 1 90); do
    BOOT=$($ADB -s "$serial" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')
    [ "$BOOT" = "1" ] && echo " ready (${i}s)" && return 0
    sleep 2
  done
  echo " TIMEOUT" && return 1
}

wait_boot "$PHONE_SERIAL" "phone"
wait_boot "$WATCH_SERIAL" "watch"

echo ""
$ADB devices
echo ""

# --- Open sign-in screens ---
echo "Opening account settings on both emulators..."
$ADB -s "$PHONE_SERIAL" shell am start -a android.settings.ADD_ACCOUNT_SETTINGS 2>/dev/null
$ADB -s "$WATCH_SERIAL" shell am start -a android.settings.ADD_ACCOUNT_SETTINGS 2>/dev/null
echo "Sign in to Google on both devices if not already signed in."
echo ""

# --- Deploy app ---
if $DEPLOY; then
  SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
  APP_DIR="$(dirname "$SCRIPT_DIR")"
  echo "Building and deploying Convocados..."
  cd "$APP_DIR"
  ./gradlew :app:assembleDebug
  APK=$(find app/build/outputs/apk/debug -name "*.apk" | head -1)
  if [ -n "$APK" ]; then
    echo "Installing on watch ($WATCH_SERIAL)..."
    $ADB -s "$WATCH_SERIAL" install -r "$APK"
    echo "Launching app..."
    $ADB -s "$WATCH_SERIAL" shell am start -n dev.convocados/.MainActivity
    echo "✓ App deployed and running on watch."
  else
    echo "ERROR: APK not found after build."
    exit 1
  fi
fi

echo ""
echo "=== Emulators ready ==="
echo "Phone: $PHONE_SERIAL | Watch: $WATCH_SERIAL"
echo "To deploy later: $0 --deploy"
echo "To stop: $0 --kill"
echo ""
echo "Dev login (inject token): adb -s $WATCH_SERIAL shell am start -n com.cabeda.convocados/dev.convocados.MainActivity --es token 'YOUR_ACCESS_TOKEN'"
