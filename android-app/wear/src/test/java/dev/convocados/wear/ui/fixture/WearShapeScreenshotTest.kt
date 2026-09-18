package dev.convocados.wear.ui.fixture

import androidx.compose.runtime.Composable
import androidx.compose.ui.test.hasScrollAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performScrollToNode
import com.github.takahirom.roborazzi.captureRoboImage
import dev.convocados.wear.ui.screen.quick.QuickScoreContent
import dev.convocados.wear.ui.screen.quick.QuickSetupScreen
import dev.convocados.wear.ui.screen.quick.SaveQuickGameContent
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

    // Small round (compact Wear OS devices): the strictest bezel. These were
    // the Play "Watch shapes" rejections, so they get explicit coverage.
    @Test
    @Config(qualifiers = "w227dp-h227dp-round")
    fun quickSetupSmallRound() = shot("small_round_quick_setup") { quickSetup() }

    @Test
    @Config(qualifiers = "w227dp-h227dp-round")
    fun quickSaveSmallRound() = shot("small_round_quick_save") { quickSave() }

    @Test
    @Config(qualifiers = "w227dp-h227dp-round")
    fun liveScoreSmallRound() = shot("small_round_live_score") { liveScore() }

    @Test
    @Config(qualifiers = "w390dp-h390dp-round")
    fun quickSetupRound() = shot("round_quick_setup") { quickSetup() }

    @Test
    @Config(qualifiers = "w390dp-h390dp-notround")
    fun quickSetupSquare() = shot("square_quick_setup") { quickSetup() }

    @Test
    @Config(qualifiers = "w390dp-h390dp-round")
    fun quickSaveRound() = shot("round_quick_save") { quickSave() }

    @Test
    @Config(qualifiers = "w390dp-h390dp-notround")
    fun quickSaveSquare() = shot("square_quick_save") { quickSave() }

    @Test
    @Config(qualifiers = "w390dp-h390dp-round")
    fun quickScoreRound() = shot("round_quick_score") { quickScore() }

    @Test
    @Config(qualifiers = "w390dp-h390dp-notround")
    fun quickScoreSquare() = shot("square_quick_score") { quickScore() }

    @Test
    @Config(qualifiers = "w227dp-h227dp-round")
    fun quickScoreSmallRound() = shot("small_round_quick_score") { quickScore() }

    @Test
    @Config(qualifiers = "w390dp-h390dp-round")
    fun quickTennisRound() = shot("round_quick_tennis") { quickTennis() }

    // The bottom "Start" CTA lives below the fold on compact devices; capture it
    // scrolled into view, which is the state Play rejected (clipped by bezel).
    @Test
    @Config(qualifiers = "w227dp-h227dp-round")
    fun quickSetupBottomSmallRound() =
        shotScrolledTo("small_round_quick_setup_bottom", "Start") { quickSetup() }

    @Test
    @Config(qualifiers = "w390dp-h390dp-round")
    fun quickSetupBottomRound() =
        shotScrolledTo("round_quick_setup_bottom", "Start") { quickSetup() }

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

    @Composable
    private fun quickSetup() {
        QuickSetupScreen(onStart = { _, _, _ -> })
    }

    @Composable
    private fun quickSave() {
        SaveQuickGameContent(state = WearFixtures.quickSave)
    }

    @Composable
    private fun quickScore() {
        QuickScoreContent(
            state = WearFixtures.quickScore,
            nowOverride = WearFixtures.now,
            onIncrementOne = {},
            onDecrementOne = {},
            onIncrementTwo = {},
            onDecrementTwo = {},
            onNextSet = {},
            onToggleTiebreak = {},
        )
    }

    @Composable
    private fun quickTennis() {
        QuickScoreContent(
            state = WearFixtures.quickTennis,
            nowOverride = WearFixtures.now,
            onIncrementOne = {},
            onDecrementOne = {},
            onIncrementTwo = {},
            onDecrementTwo = {},
            onNextSet = {},
            onToggleTiebreak = {},
        )
    }

    private fun shot(name: String, content: @Composable () -> Unit) {
        composeRule.setContent { ConvocadosWearTheme(content = content) }
        composeRule.onRoot().captureRoboImage("src/test/screenshots/shapes/$name.png")
    }

    private fun shotScrolledTo(name: String, text: String, content: @Composable () -> Unit) {
        composeRule.setContent { ConvocadosWearTheme(content = content) }
        composeRule.onNode(hasScrollAction()).performScrollToNode(hasText(text))
        composeRule.onRoot().captureRoboImage("src/test/screenshots/shapes/$name.png")
    }
}
