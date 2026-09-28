#!/bin/zsh
# Measure Wear OS frame timing on a connected watch over adb.
#
# WHY THIS SCRIPT IS THIS CAREFUL — every default here was learned the hard way
# and each one silently invalidates the measurement:
#
#  1. BUILD TYPE. Only a *release* build is meaningful. A debug build carries
#     Compose tooling, no R8 and no minification, and measures ~23% jank with a
#     150ms p90 where release measures ~2.8% with a 30ms p90. Optimising
#     against debug numbers optimises noise.
#
#  2. GESTURES MUST AVOID THE SCREEN EDGES. Full-height swipes get claimed by
#     Samsung's system [Gesture Monitor] edge-swipe and quickpanel (75+112 slices
#     per run). The system then competes for the gesture and a single
#     ACTION_DOWN measures 61ms with zero app work inside it. Swipes are kept to
#     x=225 (dead centre) and y in [180,300] (middle band).
#
#  3. WARMUP PASS IS DISCARDED. The first pass after launch pays for cold
#     composition, font/registry building and first-layout. Only the second pass
#     measures steady-state scrolling.
#
#  4. SCREEN MUST STAY AWAKE. The watch sleeps in ~15s by default and drops WiFi
#     with it, which makes the device vanish from adb mid-run and yields a
#     nonsense "0 frames" reading. Set screen_off_timeout high before measuring.
#
#  5. WHICH SCREEN. GamesScreen auto-navigates to the suggested game on launch
#     (GamesScreen.kt:70), and that destination does not scroll, so a scroll
#     harness measures 3 frames instead of ~650. To measure the games *list*,
#     build with auto-nav disabled — see docs/wear-performance.md.
#
# Usage:
#   scripts/wear-frame-timing.sh <package> [label]
#   scripts/wear-frame-timing.sh com.google.android.apps.wearable.settings control
set -e

PKG="${1:-com.cabeda.Convocados}"
LABEL="${2:-run}"
DEVICE="${WEAR_SERIAL:-$(adb devices | awk 'NR==2{print $1}')}"
SWIPE_PX="${WEAR_SWIPE_PX:-120}"
# Middle band of a 450x450 round display, clear of every system edge gesture.
Y_MID=300
Y_MID_MINUS=$((Y_MID - SWIPE_PX))
X_CENTRE=225

if [ -z "$DEVICE" ]; then
  echo "No adb device. Connect the watch and re-run (see docs/wear-performance.md)." >&2
  exit 1
fi

pass() {
  for _ in 1 2 3 4 5 6; do
    adb -s "$DEVICE" shell input swipe $X_CENTRE $Y_MID $X_CENTRE $Y_MID_MINUS 250
    sleep 0.4
    adb -s "$DEVICE" shell input swipe $X_CENTRE $Y_MID_MINUS $X_CENTRE $Y_MID 250
    sleep 0.4
  done
}

adb -s "$DEVICE" shell input keyevent KEYCODE_WAKEUP >/dev/null
sleep 1
adb -s "$DEVICE" shell am force-stop "$PKG" >/dev/null
sleep 2
adb -s "$DEVICE" shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
sleep 8

pass          # warmup — deliberately discarded
sleep 2
adb -s "$DEVICE" shell dumpsys gfxinfo "$PKG" reset >/dev/null
pass
sleep 2

echo "########## $LABEL — $PKG (warm, ${SWIPE_PX}px swipes) ##########"
adb -s "$DEVICE" shell dumpsys window | grep mCurrentFocus
adb -s "$DEVICE" shell dumpsys gfxinfo "$PKG" | grep -E \
  "Total frames|Janky frames:|50th percentile|90th percentile|95th percentile|99th percentile|Number Missed Vsync|Number Slow UI thread|Number Slow issue draw commands|50th gpu|90th gpu"
