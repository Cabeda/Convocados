package dev.convocados.ui.fixture

import androidx.compose.runtime.Composable
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onRoot
import com.github.takahirom.roborazzi.captureRoboImage
import dev.convocados.ui.screen.stats.StatsContent
import dev.convocados.ui.theme.ConvocadosTheme
import dev.convocados.ui.theme.ThemeMode
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "w840dp-h900dp")
class WideFixtureScreenshotTest {
    @get:Rule val composeRule = createComposeRule()

    @Test fun games_light() = snapshot("tablet/games_light", ThemeMode.Light) { GamesFixtureContent(FixtureData.games, {}, {}) }
    @Test fun games_dark() = snapshot("tablet/games_dark", ThemeMode.Dark) { GamesFixtureContent(FixtureData.games, {}, {}) }
    @Test fun stats_light() = snapshot("tablet/stats_light", ThemeMode.Light) { StatsContent(FixtureData.stats, false, null, {}, {}) }
    @Test fun stats_dark() = snapshot("tablet/stats_dark", ThemeMode.Dark) { StatsContent(FixtureData.stats, false, null, {}, {}) }
    @Test fun event_light() = snapshot("tablet/event_light", ThemeMode.Light) { EventFixtureContent(FixtureData.event, {}, {}) }
    @Test fun event_dark() = snapshot("tablet/event_dark", ThemeMode.Dark) { EventFixtureContent(FixtureData.event, {}, {}) }
    @Test fun adaptive_light() = snapshot("tablet/adaptive_light", ThemeMode.Light) { AdaptiveGamesFixtureContent(FixtureData.games, FixtureData.event, {}, {}, {}, {}) }
    @Test fun adaptive_dark() = snapshot("tablet/adaptive_dark", ThemeMode.Dark) { AdaptiveGamesFixtureContent(FixtureData.games, FixtureData.event, {}, {}, {}, {}) }
    @Test fun profile_light() = snapshot("tablet/profile_light", ThemeMode.Light) { ProfileFixtureContent(FixtureData.user, {}, {}) }
    @Test fun profile_dark() = snapshot("tablet/profile_dark", ThemeMode.Dark) { ProfileFixtureContent(FixtureData.user, {}, {}) }
    @Test fun state_empty_light() = stateSnapshot("tablet", FixtureState.Empty)
    @Test fun state_loading_light() = stateSnapshot("tablet", FixtureState.Loading)
    @Test fun state_error_light() = stateSnapshot("tablet", FixtureState.Error)
    @Test fun state_offline_light() = stateSnapshot("tablet", FixtureState.Offline)
    @Test fun state_live_light() = stateSnapshot("tablet", FixtureState.Live)
    @Test fun state_urgent_light() = stateSnapshot("tablet", FixtureState.Urgent)
    @Test fun state_payment_light() = stateSnapshot("tablet", FixtureState.Payment)

    private fun stateSnapshot(formFactor: String, state: FixtureState) {
        composeRule.setContent { ConvocadosTheme(themeMode = ThemeMode.Light) { EventStateFixtureContent(state) } }
        composeRule.onRoot().captureRoboImage("src/test/screenshots/goldens/$formFactor/state_${state.name.lowercase()}.png")
    }

    private fun snapshot(name: String, mode: ThemeMode, content: @Composable () -> Unit) {
        composeRule.setContent { ConvocadosTheme(themeMode = mode, content = content) }
        composeRule.onRoot().captureRoboImage("src/test/screenshots/store-listing/$name.png")
    }
}

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "w673dp-h841dp")
class FoldableFixtureScreenshotTest {
    @get:Rule val composeRule = createComposeRule()

    @Test fun games_light() = snapshot("foldable/games_light", ThemeMode.Light) { GamesFixtureContent(FixtureData.games, {}, {}) }
    @Test fun games_dark() = snapshot("foldable/games_dark", ThemeMode.Dark) { GamesFixtureContent(FixtureData.games, {}, {}) }
    @Test fun stats_light() = snapshot("foldable/stats_light", ThemeMode.Light) { StatsContent(FixtureData.stats, false, null, {}, {}) }
    @Test fun stats_dark() = snapshot("foldable/stats_dark", ThemeMode.Dark) { StatsContent(FixtureData.stats, false, null, {}, {}) }
    @Test fun event_light() = snapshot("foldable/event_light", ThemeMode.Light) { EventFixtureContent(FixtureData.event, {}, {}) }
    @Test fun event_dark() = snapshot("foldable/event_dark", ThemeMode.Dark) { EventFixtureContent(FixtureData.event, {}, {}) }
    @Test fun adaptive_light() = snapshot("foldable/adaptive_light", ThemeMode.Light) { AdaptiveGamesFixtureContent(FixtureData.games, FixtureData.event, {}, {}, {}, {}) }
    @Test fun adaptive_dark() = snapshot("foldable/adaptive_dark", ThemeMode.Dark) { AdaptiveGamesFixtureContent(FixtureData.games, FixtureData.event, {}, {}, {}, {}) }
    @Test fun profile_light() = snapshot("foldable/profile_light", ThemeMode.Light) { ProfileFixtureContent(FixtureData.user, {}, {}) }
    @Test fun profile_dark() = snapshot("foldable/profile_dark", ThemeMode.Dark) { ProfileFixtureContent(FixtureData.user, {}, {}) }
    @Test fun state_empty_light() = stateSnapshot("foldable", FixtureState.Empty)
    @Test fun state_loading_light() = stateSnapshot("foldable", FixtureState.Loading)
    @Test fun state_error_light() = stateSnapshot("foldable", FixtureState.Error)
    @Test fun state_offline_light() = stateSnapshot("foldable", FixtureState.Offline)
    @Test fun state_live_light() = stateSnapshot("foldable", FixtureState.Live)
    @Test fun state_urgent_light() = stateSnapshot("foldable", FixtureState.Urgent)
    @Test fun state_payment_light() = stateSnapshot("foldable", FixtureState.Payment)

    private fun stateSnapshot(formFactor: String, state: FixtureState) {
        composeRule.setContent { ConvocadosTheme(themeMode = ThemeMode.Light) { EventStateFixtureContent(state) } }
        composeRule.onRoot().captureRoboImage("src/test/screenshots/goldens/$formFactor/state_${state.name.lowercase()}.png")
    }

    private fun snapshot(name: String, mode: ThemeMode, content: @Composable () -> Unit) {
        composeRule.setContent { ConvocadosTheme(themeMode = mode, content = content) }
        composeRule.onRoot().captureRoboImage("src/test/screenshots/store-listing/$name.png")
    }
}
