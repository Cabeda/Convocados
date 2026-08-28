package dev.convocados.ui.fixture

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
@Config(qualifiers = "w411dp-h891dp")
class PhoneFixtureScreenshotTest {

    @get:Rule
    val composeRule = createComposeRule()

    @Test fun games_light() = snapshot("phone/games_light", ThemeMode.Light) { GamesFixtureContent(FixtureData.games, {}, {}) }
    @Test fun games_dark() = snapshot("phone/games_dark", ThemeMode.Dark) { GamesFixtureContent(FixtureData.games, {}, {}) }
    @Test fun stats_light() = snapshot("phone/stats_light", ThemeMode.Light) { StatsFixture() }
    @Test fun stats_dark() = snapshot("phone/stats_dark", ThemeMode.Dark) { StatsFixture() }
    @Test fun event_light() = snapshot("phone/event_light", ThemeMode.Light) { EventFixtureContent(FixtureData.event, {}, {}) }
    @Test fun event_dark() = snapshot("phone/event_dark", ThemeMode.Dark) { EventFixtureContent(FixtureData.event, {}, {}) }
    @Test fun profile_light() = snapshot("phone/profile_light", ThemeMode.Light) { ProfileFixtureContent(FixtureData.user, {}, {}) }
    @Test fun profile_dark() = snapshot("phone/profile_dark", ThemeMode.Dark) { ProfileFixtureContent(FixtureData.user, {}, {}) }

    @androidx.compose.runtime.Composable
    private fun StatsFixture() {
        StatsContent(
            stats = FixtureData.stats,
            loading = false,
            error = null,
            onRefresh = {},
            onEventClick = {},
        )
    }

    private fun snapshot(name: String, mode: ThemeMode, content: @androidx.compose.runtime.Composable () -> Unit) {
        composeRule.setContent { ConvocadosTheme(themeMode = mode, content = content) }
        composeRule.onRoot().captureRoboImage("src/test/screenshots/store-listing/$name.png")
    }
}
