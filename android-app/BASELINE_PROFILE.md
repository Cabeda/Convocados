# Baseline Profiles

The app ships a baseline profile at `app/src/main/baseline-prof.txt`. The
`androidx.profileinstaller` dependency compiles these rules ahead-of-time at
install, improving cold start and first-scroll jank without waiting for the
JIT to warm up.

The committed file is a **hand-authored starter** covering the cold-start
critical path (Application → MainActivity → theme → navigation → first
screens). For best results, replace it with a **device-measured** profile.

## Regenerating an optimized profile

Generating an optimal profile requires running a Macrobenchmark on a real
device or emulator, so it is not part of CI.

1. Add a `:baselineprofile` module (a `com.android.test` module) with the
   `androidx.baselineprofile` plugin and a `BaselineProfileGenerator` test that
   exercises the main user journeys (open app → list → event detail → scroll).

   ```kotlin
   // baselineprofile/build.gradle.kts
   plugins {
       id("com.android.test")
       id("org.jetbrains.kotlin.android")
       id("androidx.baselineprofile")
   }
   ```

   ```kotlin
   @get:Rule val rule = BaselineProfileRule()

   @Test fun generate() = rule.collect(packageName = "com.cabeda.Convocados") {
       startActivityAndWait()
       // scroll the games list, open an event, etc.
   }
   ```

2. Apply the `androidx.baselineprofile` plugin to `:app` and add
   `baselineProfile(project(":baselineprofile"))`.

3. Run on a connected device/emulator:

   ```bash
   ./gradlew :app:generateBaselineProfile
   ```

   This overwrites `app/src/main/baseline-prof.txt` (and produces a startup
   profile) measured on-device.

4. Verify the improvement with a Macrobenchmark (`StartupTimingMetric`,
   `FrameTimingMetric`) comparing `CompilationMode.None()` vs
   `CompilationMode.Partial(baselineProfile)`.
