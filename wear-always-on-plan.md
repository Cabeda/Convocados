# Implementation Plan: Wear OS Always-On Game Screen

This plan details the implementation steps to keep the Wear OS game screen on the forefront during active gameplay, preventing it from timing out and exiting to the watch face or main menu. 

Following the user's preference aligned during our design discussions:
- **Solution Approach**: We will use `keepScreenOn = true` (via a Compose `DisposableEffect` using `LocalView.current`) on the active score screens (`ScoreScreen` and `QuickScoreScreen`).
- **Configuration**: We will add a toggle setting ("Keep screen on", defaulting to `true`) in the game settings section of the app (available in `GameSettingsScreen` and `TeamsScreen` setting section), persisted per game in `GameSettings`.

---

## Files to Modify

### 1. GameSettings Data Model
**File**: [GameSettings.kt](file:///Users/jose.cabeda/Git/low-code-platform-wearos-always-on/android-app/wear/src/main/java/dev/convocados/wear/data/alarm/GameSettings.kt)

Add a `keepScreenOn` property defaulting to `true` inside `GameSettings`. Because it has a default value, kotlin-serialization handles deserialization of existing stored settings automatically without breaking backward compatibility.

```kotlin
@Serializable
data class GameSettings(
    val kickoffEpochMs: Long? = null,
    val scheduledKickoffMs: Long? = null,
    val durationMinutes: Int = 60,
    val alarms: List<GameAlarm> = emptyList(),
    val keepScreenOn: Boolean = true, // Added field
)
```

---

### 2. Game Settings View Model
**File**: [GameSettingsViewModel.kt](file:///Users/jose.cabeda/Git/low-code-platform-wearos-always-on/android-app/wear/src/main/java/dev/convocados/wear/ui/screen/settings/GameSettingsViewModel.kt)

1. Add `keepScreenOn` to `GameSettingsUiState`.
2. Populate `keepScreenOn` in `load` when collecting settings.
3. Expose a public function `setKeepScreenOn(enabled: Boolean)` to persist the updated configuration state.

```kotlin
// In GameSettingsUiState:
data class GameSettingsUiState(
    val isLoading: Boolean = true,
    val kickoffEpochMs: Long = 0,
    val isKickoffOverridden: Boolean = false,
    val alarms: List<GameAlarm> = emptyList(),
    val canScheduleExact: Boolean = true,
    val keepScreenOn: Boolean = true, // Added field
)

// In GameSettingsViewModel:
// Inside load(eventId) collect:
store.settings(eventId).collect { s ->
    _uiState.value = GameSettingsUiState(
        isLoading = false,
        kickoffEpochMs = effectiveKickoff(s),
        isKickoffOverridden = s.kickoffEpochMs != null,
        alarms = s.alarms,
        canScheduleExact = scheduler.canScheduleExact(),
        keepScreenOn = s.keepScreenOn, // Exposed field
    )
}

// Add state transition helper:
fun setKeepScreenOn(enabled: Boolean) = apply {
    it.copy(keepScreenOn = enabled)
}
```

---

### 3. Strings Resources
**File**: [strings.xml](file:///Users/jose.cabeda/Git/low-code-platform-wearos-always-on/android-app/wear/src/main/res/values/strings.xml)

Add the toggle label resource:
```xml
    <!-- Settings Screen -->
    <string name="keep_screen_on_label">Keep screen on</string>
```

---

### 4. Game Settings Screen
**File**: [GameSettingsScreen.kt](file:///Users/jose.cabeda/Git/low-code-platform-wearos-always-on/android-app/wear/src/main/java/dev/convocados/wear/ui/screen/settings/GameSettingsScreen.kt)

Add the `ToggleChip` for the `keepScreenOn` config before the alarms section.

```kotlin
// Add under kickoff overrides and before exact-alarm permission / alarms header:
item {
    ToggleChip(
        checked = state.keepScreenOn,
        onCheckedChange = { viewModel.setKeepScreenOn(it) },
        label = { Text(stringResource(R.string.keep_screen_on_label)) },
        toggleControl = {
            Switch(
                checked = state.keepScreenOn,
                onCheckedChange = null
            )
        },
        modifier = Modifier.fillMaxWidth(),
    )
}
```

---

### 5. Teams Screen Settings Section
**File**: [TeamsScreen.kt](file:///Users/jose.cabeda/Git/low-code-platform-wearos-always-on/android-app/wear/src/main/java/dev/convocados/wear/ui/screen/teams/TeamsScreen.kt)

Ensure the setting toggle is also displayed in the settings lazy column within the `TeamsScreen`.

```kotlin
// Add inside the ScalingLazyColumn under the kickoff buttons and before the alarm permissions/alarms header:
item {
    ToggleChip(
        checked = settingsState.keepScreenOn,
        onCheckedChange = { settingsViewModel.setKeepScreenOn(it) },
        label = { Text(stringResource(R.string.keep_screen_on_label)) },
        toggleControl = {
            Switch(
                checked = settingsState.keepScreenOn,
                onCheckedChange = null
            )
        },
        modifier = Modifier.fillMaxWidth(),
    )
}
```

---

### 6. Score View Model
**File**: [ScoreViewModel.kt](file:///Users/jose.cabeda/Git/low-code-platform-wearos-always-on/android-app/wear/src/main/java/dev/convocados/wear/ui/screen/score/ScoreViewModel.kt)

Expose the settings value through `ScoreUiState`.

```kotlin
// In ScoreUiState:
data class ScoreUiState(
    // ...
    val keepScreenOn: Boolean = true, // Added field
)

// In ScoreViewModel inside load(eventId) settings flow collection:
_uiState.update { state ->
    state.copy(
        // ...
        kickoffEpochMs = kickoffMs,
        nextAlarmAtMs = nextAlarm,
        keepScreenOn = settings.keepScreenOn, // Exposed field
        isLoading = false,
    )
}
```

---

### 7. Score Screen (Active Game UI)
**File**: [ScoreScreen.kt](file:///Users/jose.cabeda/Git/low-code-platform-wearos-always-on/android-app/wear/src/main/java/dev/convocados/wear/ui/screen/score/ScoreScreen.kt)

Use a Compose `DisposableEffect` that references `LocalView.current` and conditionally updates `keepScreenOn` based on whether the game is actively being scored (`state.history != null`) and the setting is enabled.

```kotlin
// In ScoreScreen:
val state by viewModel.uiState.collectAsState()
val isAmbient = LocalAmbientMode.current

// Conditionally keep the screen on if scoring is active and setting is checked
val shouldKeepScreenOn = state.history != null && state.keepScreenOn
if (shouldKeepScreenOn) {
    val view = LocalView.current
    DisposableEffect(view) {
        view.keepScreenOn = true
        onDispose {
            view.keepScreenOn = false
        }
    }
}
```

---

### 8. Quick Game Score Screen (Active Game UI)
**File**: [QuickScoreScreen.kt](file:///Users/jose.cabeda/Git/low-code-platform-wearos-always-on/android-app/wear/src/main/java/dev/convocados/wear/ui/screen/quick/QuickScoreScreen.kt)

Quick games start immediately. By default, keep the screen active for quick games.

```kotlin
// In QuickScoreScreen:
val view = LocalView.current
DisposableEffect(view) {
    view.keepScreenOn = true
    onDispose {
        view.keepScreenOn = false
    }
}
```

---

## Testing Plan

### 1. Data Store Unit Tests
**File**: [GameSettingsStoreTest.kt](file:///Users/jose.cabeda/Git/low-code-platform-wearos-always-on/android-app/wear/src/test/java/dev/convocados/wear/data/alarm/GameSettingsStoreTest.kt)

Add unit tests verifying:
- Default `keepScreenOn` settings are `true` when no settings exist.
- Setting updates correctly toggle `keepScreenOn` state.

```kotlin
@Test
fun `current returns default keepScreenOn true for missing event`() {
    every { prefs.getString("missing", null) } returns null
    val s = store.current("missing")
    assertTrue(s.keepScreenOn)
}

@Test
fun `update changes keepScreenOn value`() {
    every { prefs.getString("e1", null) } returns null
    val result = store.update("e1") { it.copy(keepScreenOn = false) }
    assertFalse(result.keepScreenOn)
    verify { editor.putString("e1", any()) }
}
```

### 2. View Model Unit Tests
**File**: [ScoreViewModelTest.kt](file:///Users/jose.cabeda/Git/low-code-platform-wearos-always-on/android-app/wear/src/test/java/dev/convocados/wear/ui/screen/score/ScoreViewModelTest.kt)

Verify that the `ScoreViewModel` collects and propagates `keepScreenOn` value to the UI state.
```kotlin
@Test
fun `load fetches keepScreenOn from settings`() = runTest {
    val game = makeGame("e1")
    val history = makeHistory("h1", "e1", 0, 0)
    val settingsFlow = MutableStateFlow(GameSettings(keepScreenOn = false))
    
    every { settingsStore.settings("e1") } returns settingsFlow
    coEvery { repository.getGame("e1") } returns game
    coEvery { repository.refreshHistory("e1") } returns Result.success(Unit)
    coEvery { repository.observeLatestHistory("e1") } returns flowOf(history)

    val viewModel = makeViewModel()
    viewModel.load("e1")
    advanceUntilIdle()

    viewModel.uiState.test {
        val state = awaitItem()
        assertFalse(state.keepScreenOn)
        cancelAndIgnoreRemainingEvents()
    }
}
```
