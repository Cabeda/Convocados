package dev.convocados.wear.ui.fixture

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.unit.Density
import com.github.takahirom.roborazzi.captureRoboImage
import dev.convocados.wear.ui.screen.score.ScoreFixtureContent
import dev.convocados.wear.ui.theme.ConvocadosWearTheme
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Renders the screens with a second text line at a 2x font scale — the setting
 * Play's large-font sweep uses. The captures show what a reviewer sees; the
 * status/clock assertion guards the overlap that shipped.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class WearLargeFontTest {

    @get:Rule
    val composeRule = createComposeRule()

    @Test
    @Config(qualifiers = "w390dp-h390dp-round")
    fun gamesRound() = shot2x("round_games_2x") { games() }

    @Test
    @Config(qualifiers = "w390dp-h390dp-round")
    fun historyRound() = shot2x("round_history_2x") { history() }

    @Test
    @Config(qualifiers = "w390dp-h390dp-round")
    fun liveScoreRound() {
        shot2x("round_live_score_2x") { liveScore() }
        assertStatusAboveClock()
    }

    // The strictest bezel: the offline status sits just above the clock.
    @Test
    @Config(qualifiers = "w227dp-h227dp-round")
    fun liveScoreSmallRound() {
        shot2x("small_round_live_score_2x") { liveScore() }
        assertStatusAboveClock()
    }

    private fun shot2x(name: String, content: @Composable () -> Unit) {
        composeRule.setContent {
            val density = LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(density.density, 2f)) {
                ConvocadosWearTheme(content = content)
            }
        }
        composeRule.onRoot().captureRoboImage("src/test/screenshots/shapes/$name.png")
    }

    /**
     * Both the offline status and the clock are anchored to the bottom, so a
     * large font scale used to draw the status over the clock.
     */
    private fun assertStatusAboveClock() {
        val status = composeRule.onAllNodes(
            // Matches both the full sentence and its large-font short form.
            hasText("Will sync", substring = true),
            useUnmergedTree = true,
        ).fetchSemanticsNodes().firstOrNull()
        assertNotNull("offline status not rendered", status)
        val clock = composeRule.onAllNodes(
            SemanticsMatcher("clock text") { node ->
                node.config.getOrNull(SemanticsProperties.Text)
                    ?.any { Regex("""\d+:\d{2}""").matches(it.text) } == true
            },
            useUnmergedTree = true,
        ).fetchSemanticsNodes().firstOrNull()
        assertNotNull("clock not rendered", clock)
        assertTrue(
            "offline status ${status!!.boundsInRoot} overlaps clock ${clock!!.boundsInRoot}",
            status.boundsInRoot.bottom <= clock.boundsInRoot.top + 1f,
        )
    }

    @Composable
    private fun games() = WearGamesFixtureContent(
        games = WearFixtures.games,
        pendingSyncCount = 1,
        now = WearFixtures.now,
    )

    @Composable
    private fun history() =
        WearHistoryFixtureContent(WearFixtures.history, now = WearFixtures.now)

    @Composable
    private fun liveScore() = ScoreFixtureContent(
        state = WearFixtures.liveScore,
        now = WearFixtures.now,
        onIncrementOne = {},
        onIncrementTwo = {},
        onDecrementOne = {},
        onDecrementTwo = {},
        onUndo = {},
    )
}
