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

/** Landscape smoke coverage for the shared phone/tablet adaptive shell. */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "w891dp-h411dp")
class LandscapeFixtureScreenshotTest {
    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun games_light() = snapshot("landscape/games_light", ThemeMode.Light) {
        GamesFixtureContent(FixtureData.games, {}, {})
    }

    @Test
    fun games_dark() = snapshot("landscape/games_dark", ThemeMode.Dark) {
        GamesFixtureContent(FixtureData.games, {}, {})
    }

    @Test
    fun event_light() = snapshot("landscape/event_light", ThemeMode.Light) {
        EventFixtureContent(FixtureData.event, {}, {})
    }

    @Test
    fun event_dark() = snapshot("landscape/event_dark", ThemeMode.Dark) {
        EventFixtureContent(FixtureData.event, {}, {})
    }

    @Test
    fun stats_light() = snapshot("landscape/stats_light", ThemeMode.Light) {
        StatsContent(FixtureData.stats, false, null, {}, {})
    }

    @Test
    fun stats_dark() = snapshot("landscape/stats_dark", ThemeMode.Dark) {
        StatsContent(FixtureData.stats, false, null, {}, {})
    }

    private fun snapshot(name: String, mode: ThemeMode, content: @Composable () -> Unit) {
        composeRule.setContent { ConvocadosTheme(themeMode = mode, content = content) }
        composeRule.onRoot().captureRoboImage("src/test/screenshots/$name.png")
    }
}
