package dev.convocados.wear.ui.fixture

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onRoot
import androidx.wear.compose.material3.MaterialTheme
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
            ConvocadosWearTheme {
                // Paint the app's own background across the whole capture. Without
                // it the surface floats on Robolectric's default window colour and
                // the screenshot is not "only the app interface" — the exact
                // framing Google Play rejected the Wear listing for.
                Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
                    content()
                }
            }
        }
        composeRule.onRoot().captureRoboImage("src/test/screenshots/store-listing/$name.png")
    }
}
