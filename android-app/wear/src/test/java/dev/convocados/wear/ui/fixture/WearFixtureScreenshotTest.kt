package dev.convocados.wear.ui.fixture

import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onRoot
import com.github.takahirom.roborazzi.captureRoboImage
import dev.convocados.wear.ui.screen.score.ScoreFixtureContent
import dev.convocados.wear.ui.theme.ConvocadosWearTheme
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "w390dp-h390dp")
class WearFixtureScreenshotTest {

    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun games() = snapshot("games") {
        WearGamesFixtureContent(
            games = WearFixtures.games,
            pendingSyncCount = 1,
            now = WearFixtures.now,
        )
    }

    @Test
    fun liveScore() = snapshot("live_score") {
        ScoreFixtureContent(
            state = WearFixtures.liveScore,
            now = WearFixtures.now,
            onIncrementOne = {},
            onIncrementTwo = {},
            onDecrementOne = {},
            onDecrementTwo = {},
            onUndo = {},
        )
    }

    @Test
    fun quickGame() = snapshot("quick_game") {
        ScoreFixtureContent(
            state = WearFixtures.quickGame,
            now = WearFixtures.now,
            onIncrementOne = {},
            onIncrementTwo = {},
            onDecrementOne = {},
            onDecrementTwo = {},
            onUndo = {},
        )
    }

    @Test
    fun history() = snapshot("history") {
        WearHistoryFixtureContent(WearFixtures.history, now = WearFixtures.now)
    }

    private fun snapshot(name: String, content: @androidx.compose.runtime.Composable () -> Unit) {
        composeRule.setContent {
            ConvocadosWearTheme(content = content)
        }
        composeRule.onRoot().captureRoboImage("src/test/screenshots/store-listing/$name.png")
    }
}
