package dev.convocados.wear.ui.fixture

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
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

/**
 * Renders the four Wear store-listing screens on **both** display shapes.
 *
 * Play's Wear screenshots are opaque 1:1 images of the app interface (Wear app
 * quality WO-G5: no device frames, no extra text/graphics/backgrounds, no
 * transparent backgrounds or masking). The app draws differently on round and
 * square (`RoundSafeLayout` has a round branch and a square `else`), so the
 * listing carries both — each shape shows its own interface rather than a
 * square layout on a round watch. Round captures are opaque black squares with
 * the round UI: they are **not** circular-masked, because transparent corners
 * are exactly what WO-G5 forbids.
 */
private const val ROUND_QUALIFIERS = "w390dp-h390dp-round"
private const val SQUARE_QUALIFIERS = "w390dp-h390dp-notround"

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class WearFixtureScreenshotTest {

    @get:Rule
    val composeRule = createComposeRule()

    @Test
    @Config(qualifiers = ROUND_QUALIFIERS)
    fun gamesRound() = snapshot("games_round") { games() }

    @Test
    @Config(qualifiers = SQUARE_QUALIFIERS)
    fun gamesSquare() = snapshot("games_square") { games() }

    @Test
    @Config(qualifiers = ROUND_QUALIFIERS)
    fun liveScoreRound() = snapshot("live_score_round") { liveScore() }

    @Test
    @Config(qualifiers = SQUARE_QUALIFIERS)
    fun liveScoreSquare() = snapshot("live_score_square") { liveScore() }

    @Test
    @Config(qualifiers = ROUND_QUALIFIERS)
    fun quickGameRound() = snapshot("quick_game_round") { quickGame() }

    @Test
    @Config(qualifiers = SQUARE_QUALIFIERS)
    fun quickGameSquare() = snapshot("quick_game_square") { quickGame() }

    @Test
    @Config(qualifiers = ROUND_QUALIFIERS)
    fun historyRound() = snapshot("history_round") { history() }

    @Test
    @Config(qualifiers = SQUARE_QUALIFIERS)
    fun historySquare() = snapshot("history_square") { history() }

    @Composable
    private fun games() {
        WearGamesFixtureContent(
            games = WearFixtures.games,
            pendingSyncCount = 1,
            now = WearFixtures.now,
        )
    }

    @Composable
    private fun liveScore() {
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

    @Composable
    private fun quickGame() {
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

    @Composable
    private fun history() {
        WearHistoryFixtureContent(WearFixtures.history, now = WearFixtures.now)
    }

    private fun snapshot(name: String, content: @Composable () -> Unit) {
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
