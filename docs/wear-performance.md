# Wear OS frame timing

How to tell whether `:wear` is hitting 60fps on a real watch, and what the
numbers actually mean. Written from a Perfetto investigation on a Galaxy
Watch 4 44mm (`SM-R870`, 450×450, 340dpi).

## TL;DR

- **Measure a release build.** Debug is not a proxy — it is a different program.
- The panel is 60Hz and *only* 60Hz (`supportedRefreshRates [60.000004]`,
  `mRefreshRateChangeable: false`), and the Watch 4 is a 60fps-capable device.
  So **~46fps is a real gap in our app, not a hardware ceiling** — there is no
  device excuse available for it.
- `:wear` scrolls the games list at **~46fps / 31ms per frame** in release, and
  the remaining cost is in the render pipeline (`postAndWait` +
  `dequeueBuffer`), not in Compose recomposition.

## Prerequisites

```bash
# Wear OS drops WiFi when the screen sleeps, so the device disappears from adb.
adb shell settings put system screen_off_timeout 1800000

# Confirm the panel really is 60Hz — do not assume.
adb shell dumpsys display | grep -E "renderFrameRate|supportedRefreshRates|mRefreshRateChangeable"
```

## Running a measurement

```bash
# 1. Release build. The debug number is meaningless (see below).
./gradlew :wear:assembleRelease
adb install -r android-app/wear/build/outputs/apk/release/wear-release.apk

# 2. Warm, edge-safe scroll measurement.
scripts/wear-frame-timing.sh com.cabeda.Convocados "games list"
```

For a control — what this device and this harness can do at all:

```bash
scripts/wear-frame-timing.sh com.google.android.apps.wearable.settings control
```

## What the harness gets wrong if you don't follow it

| Trap | Symptom | Why |
|---|---|---|
| Measuring a **debug** build | 23% jank, p90 150ms | Compose tooling, no R8. Release: 2.8% jank, p90 30ms. |
| **Full-height swipes** | `ACTION_DOWN` costs 61ms with zero app work inside | Samsung `[Gesture Monitor] edge-swipe` + `quickpanel` claim the gesture and contend with the app |
| No **warmup pass** | inflated p50/p90 | first pass pays cold composition and first-layout |
| Screen sleeps | `Total frames rendered: 0` | watch drops WiFi with the screen |
| Measuring the wrong screen | 3 frames instead of ~650 | `GamesScreen` auto-navigates to a non-scrolling destination |

### Measuring the games list specifically

`GamesScreen.kt:70` auto-navigates to the suggested game on launch. That
destination (`ScoreScreen`) does not scroll, so the scroll harness measures
almost nothing. To measure the list, build with that `LaunchedEffect` disabled,
or tap back to the list before the measured pass.

## Debug vs release

Same code, same device, same gestures, release only (R8 + no tooling):

| Build | Janky | p50 | p90 | Missed vsync | GPU p50 |
|---|---|---|---|---|---|
| debug | 23.2% | 22ms | 150ms | 44 | 9ms |
| **release** | **2.8%** | **21ms** | **30ms** | **0** | 12ms |

Three hypotheses that looked real in debug and vanished in release:

| Hypothesis | Debug | Release | Verdict |
|---|---|---|---|
| `rememberAnimatedTextFontRegistry` (106ms + 30ms) | 41.3% → 41.6% | — | one-time cold-start cost, outside the scroll window |
| Navigation transitions (`AnimatedContent`/predictive back) | 41.3% → 48.8% | — | the list is the slower screen, not the nav |
| `nestedScroll(pullToRefresh)` per-delta state writes | 23.2% → 28.0% | 2.8% → 2.9% | no effect |
| Full-screen `clip(CircleShape)` (`roundBezelClip`) | — | 2.8% → 2.9% | no effect; kept for the Play watch-shapes guarantee |

## Where the remaining time goes

Release trace, self time on the app main thread over a 14s window:

```
postAndWait            526×  3083ms  5.86ms   ← blocked waiting on the RenderThread sync
animation              525×   480ms  0.92ms
Recomposer:animation   525×   447ms  0.85ms
AndroidOwner:measureAndLayout 142×  255ms  1.79ms
AndroidOwner:draw      516×   247ms  0.48ms
wear-compose:tlc:measure 132×  147ms  1.12ms
Recomposer:recompose   525×   105ms  0.20ms
```

RenderThread, same window:

```
Drawing 450x450         526×  3371ms  6.41ms
dequeueBuffer           526×  2639ms  5.02ms   ← waiting for a free buffer
eglSwapBuffersWithDamage 526× 1509ms  2.87ms
```

Plus `GPU completion` 8.05ms and `HWC release` 10.09ms on their own threads.

Interpretation:

- **Compose is not the bottleneck.** Recompose is 0.20ms/frame; measure+layout
  is 1.79ms/frame. Total draw-op CPU time is ~0.6ms/frame.
- **The GPU/pipeline is.** ~5.8ms of each 6.41ms `Drawing` slice is GPU wait, not
  work. `dequeueBuffer` blocking is buffer-queue pressure.
- 450×450 is 202K pixels — raw fill rate is trivial, so the cost is passes,
  layers and shader work, not pixels. The device was not thermally throttled
  (status 0, CPU 41 °C).

So the remaining levers are "fewer buffer syncs" and "less to rasterise", not
micro-optimising composables.

## Per-composable attribution

`-PcomposeTracing` makes the Compose compiler emit one atrace marker per
composable (`includeTraceMarkers`) and `WearApp` installs a
`CompositionTracer` that turns them into Perfetto slices, carrying
`Type (File.kt:line)`. The runtime switch is
`convocados_compose_tracing` in `Settings.Global`:

```bash
# markers are compiled in by the build flag; the tracer is a runtime switch so
# one binary yields both an unbiased baseline (off) and attribution (on)
./gradlew :wear:assembleRelease -PcomposeTracing
adb shell settings put global convocados_compose_tracing 1

# then trace (tracer costs nothing measurable when off: 3.18% vs 2.75%)
perfetto --txt -c - -o /data/misc/perfetto-traces/wear.pftrace < config.pftxt
```

Useful queries:

```sql
-- self time on the app main thread
WITH self_t AS (
  SELECT s.name, s.track_id,
         s.dur - COALESCE((SELECT sum(c.dur) FROM slice c WHERE c.parent_id=s.id),0) AS sd
  FROM slice s
)
SELECT st.name, count(*) n, round(sum(st.sd)/1e6,1) ms
FROM self_t st
JOIN thread_track tt ON st.track_id=tt.id
JOIN thread t ON tt.utid=t.utid
JOIN process p ON t.upid=p.upid
WHERE p.name LIKE '%Convocados%' AND t.is_main_thread=1 AND st.sd>0
GROUP BY st.name ORDER BY ms DESC LIMIT 30;
```

Caveat: frame-timeline slices (`android.surfaceflinger.frametimeline`) are
depth-0, thread-less and numerically named, with a duration of exactly
16.666666ms. They will dominate any self-time aggregate if you do not exclude
them — an early version of this analysis chased them as if they were work.

## Open questions

- ~~Is ~46fps this device's ceiling for this harness?~~ **No.** The Watch 4 is a
  60fps device and the panel is 60Hz-only, so the gap is ours. The Settings-app
  control run is still worth having, to confirm the harness itself is not
  capping the measurement.
- Which render-side change closes it? The candidates are layer/raster reduction,
  not composable work. **Elevation shadows on the list chips are untested** —
  Wear M3 `Button` draws a shadow layer per tile, and shadows are exactly the
  kind of pass that costs GPU time at 450×450. Next experiment should ablate
  chip elevation and re-measure before anything else.
- `:wear` has no baseline profile. The `baselineprofile` module targets `:app`
  only (`targetProjectPath = ":app"`). Worth adding for `:wear` — it mostly
  helps cold start, which is currently 58% janky with a 150ms p50.
- `GamesScreen` auto-navigating on every launch is questionable UX in its own
  right, independent of performance.

### Getting the watch to stay awake long enough to measure

Wear OS dozes when the watch is off-wrist, and doze disables WiFi, so the device
disappears from `adb` entirely. `screen_off_timeout` does **not** prevent this —
it is wrist-detection doze, not the screen timeout. A measurement run needs
roughly 25-30s of continuous connectivity, so the watch must be **worn** for the
duration, and `screen_off_timeout` should be raised anyway:

```bash
adb shell settings put system screen_off_timeout 1800000
```
