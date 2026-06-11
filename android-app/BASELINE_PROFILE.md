# Baseline Profiles

The app ships a **device-measured** baseline profile at
`app/src/release/generated/baselineProfiles/baseline-prof.txt` (plus a
`startup-prof.txt`). The `androidx.profileinstaller` dependency compiles these
rules ahead-of-time at install, improving cold start and first-scroll jank
without waiting for the JIT to warm up.

The profile is produced by the `:baselineprofile` Macrobenchmark module
(`BaselineProfileGenerator`), which the `androidx.baselineprofile` Gradle
plugin wires into `:app` via `baselineProfile(project(":baselineprofile"))`.

## Regenerating

Generation runs a Macrobenchmark on a connected device/emulator, so it is not
part of CI.

```bash
# Boot an emulator or attach a device, then:
./gradlew :app:generateBaselineProfile
```

This re-runs the generator journey (cold start → first screen → scroll) and
overwrites `app/src/release/generated/baselineProfiles/`.

## Notes

- Release-type variants fall back to **debug signing** when no production
  keystore is configured (see `app/build.gradle.kts`), so the
  `nonMinifiedRelease` / `benchmarkRelease` variants the plugin creates can be
  built and installed locally for profiling.
- To measure the improvement, add a Macrobenchmark with `StartupTimingMetric`
  / `FrameTimingMetric` comparing `CompilationMode.None()` vs
  `CompilationMode.Partial(baselineProfile)`.
