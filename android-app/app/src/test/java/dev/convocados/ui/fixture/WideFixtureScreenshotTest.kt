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
    @Test fun profile_light() = snapshot("tablet/profile_light", ThemeMode.Light) { ProfileFixtureContent(FixtureData.user, {}, {}) }
    @Test fun profile_dark() = snapshot("tablet/profile_dark", ThemeMode.Dark) { ProfileFixtureContent(FixtureData.user, {}, {}) }

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
    @Test fun profile_light() = snapshot("foldable/profile_light", ThemeMode.Light) { ProfileFixtureContent(FixtureData.user, {}, {}) }
    @Test fun profile_dark() = snapshot("foldable/profile_dark", ThemeMode.Dark) { ProfileFixtureContent(FixtureData.user, {}, {}) }

    private fun snapshot(name: String, mode: ThemeMode, content: @Composable () -> Unit) {
        composeRule.setContent { ConvocadosTheme(themeMode = mode, content = content) }
        composeRule.onRoot().captureRoboImage("src/test/screenshots/store-listing/$name.png")
    }
}
