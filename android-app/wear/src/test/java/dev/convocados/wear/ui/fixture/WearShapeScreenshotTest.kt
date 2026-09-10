package dev.convocados.wear.ui.fixture

import androidx.compose.runtime.Composable
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

/**
 * Captures every top-level Wear screen on both round and square displays so a
 * Play "Watch shapes" regression (content clipped by the bezel/edge) is visible
 * in review. One method per (screen, shape) pair keeps the qualifier explicit.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class WearShapeScreenshotTest {

    @get:Rule
    val composeRule = createComposeRule()

    // Round (the overwhelmingly common Wear form factor).
    @Test
    @Config(qualifiers = "w390dp-h390dp-round")
    fun liveScoreRound() = shot("round_live_score") { liveScore() }

    @Test
    @Config(qualifiers = "w390dp-h390dp-round")
    fun quickGameRound() = shot("round_quick_game") { quickGame() }

    @Test
    @Config(qualifiers = "w390dp-h390dp-round")
    fun tennisRound() = shot("round_tennis") { tennis() }

    @Test
    @Config(qualifiers = "w390dp-h390dp-round")
    fun gamesRound() = shot("round_games") { games() }

    @Test
    @Config(qualifiers = "w390dp-h390dp-round")
    fun historyRound() = shot("round_history") { history() }

    // Square.
    @Test
    @Config(qualifiers = "w390dp-h390dp-notround")
    fun liveScoreSquare() = shot("square_live_score") { liveScore() }

    @Test
    @Config(qualifiers = "w390dp-h390dp-notround")
    fun quickGameSquare() = shot("square_quick_game") { quickGame() }

    @Test
    @Config(qualifiers = "w390dp-h390dp-notround")
    fun tennisSquare() = shot("square_tennis") { tennis() }

    @Test
    @Config(qualifiers = "w390dp-h390dp-notround")
    fun gamesSquare() = shot("square_games") { games() }

    @Test
    @Config(qualifiers = "w390dp-h390dp-notround")
    fun historySquare() = shot("square_history") { history() }

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
    private fun tennis() {
        ScoreFixtureContent(
            state = WearFixtures.tennisScore,
            now = WearFixtures.now,
            onIncrementOne = {},
            onIncrementTwo = {},
            onDecrementOne = {},
            onDecrementTwo = {},
            onUndo = {},
        )
    }

    @Composable
    private fun games() {
        WearGamesFixtureContent(
            games = WearFixtures.games,
            pendingSyncCount = 1,
            now = WearFixtures.now,
        )
    }

    @Composable
    private fun history() {
        WearHistoryFixtureContent(WearFixtures.history, now = WearFixtures.now)
    }

    private fun shot(name: String, content: @Composable () -> Unit) {
        composeRule.setContent { ConvocadosWearTheme(content = content) }
        composeRule.onRoot().captureRoboImage("src/test/screenshots/shapes/$name.png")
    }
}
