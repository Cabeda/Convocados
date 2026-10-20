package dev.convocados.wear.ui.fixture

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.unit.Density
import com.github.takahirom.roborazzi.captureRoboImage
import dev.convocados.wear.ui.screen.quick.QuickScoreContent
import dev.convocados.wear.ui.screen.score.ScoreFixtureContent
import dev.convocados.wear.ui.screen.score.ScoreUiState
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
        assertStatusAboveClock(expectedStatus = "Will sync")
    }

    // The strictest bezel: the offline status sits just above the clock.
    @Test
    @Config(qualifiers = "w227dp-h227dp-round")
    fun liveScoreSmallRound() {
        shot2x("small_round_live_score_2x") { liveScore() }
        assertStatusAboveClock(expectedStatus = "Will sync")
    }

    // The longer of the two statuses: it is the one that used to run widest.
    @Test
    @Config(qualifiers = "w227dp-h227dp-round")
    fun liveScoreSignInSmallRound() {
        shot2x("small_round_live_score_sign_in_2x") {
            liveScore(WearFixtures.liveScore.copy(signInRequired = true))
        }
        assertStatusAboveClock(expectedStatus = "Sign in again")
    }

    @Test
    @Config(qualifiers = "w390dp-h390dp-notround")
    fun liveScoreSquare() {
        shot2x("square_live_score_2x") { liveScore() }
        assertStatusAboveClock(expectedStatus = "Will sync")
    }

    // A large round display carries the full sentence on one line.
    @Test
    @Config(qualifiers = "w454dp-h454dp-round")
    fun liveScoreLargeRound() {
        shot2x("large_round_live_score_2x") { liveScore() }
        assertStatusAboveClock(expectedStatus = "Will sync")
    }

    // A 227dp round display is in the repo's matrix — the 1× goldens cover it
    // — but the tennis screen does not fit on one at 2x: the tile needs about
    // 132dp and the display leaves about 77dp. The golden records that
    // degradation, which #1463 tracks; the test asserts on 320dp, the
    // smallest display the app ships on.
    @Test
    @Config(qualifiers = "w227dp-h227dp-round")
    fun tennisSmallRound() = shot2x("small_round_tennis_2x") { tennis() }

    // The smallest display the app ships on: the score and every action label
    // must be readable at 2x.
    @Test
    @Config(qualifiers = "w320dp-h320dp-round")
    fun tennisSmallestSupportedRound() {
        shot2x("smallest_round_tennis_2x") { tennis() }
        for (score in listOf("40", "30")) {
            assertNotNull(
                "score $score not rendered",
                composeRule.onAllNodes(
                    hasContentDescription(score),
                    useUnmergedTree = true,
                ).fetchSemanticsNodes().firstOrNull(),
            )
        }
        for (label in listOf("Next", "Tie", "Undo", "Teams")) {
            assertNotNull(
                "action label $label not rendered",
                composeRule.onAllNodes(
                    hasText(label),
                    useUnmergedTree = true,
                ).fetchSemanticsNodes().firstOrNull(),
            )
        }
    }

    // The quick-game tennis editor has its own header and its own action row,
    // so it carries the same defect class: the labels wrapped and the header
    // ran outside the bezel.
    @Test
    @Config(qualifiers = "w320dp-h320dp-round")
    fun quickTennisSmallestSupportedRound() {
        shot2x("smallest_round_quick_tennis_2x") { quickTennis() }
        for (label in listOf("Next", "Tie")) {
            assertNotNull(
                "quick action label $label not rendered",
                composeRule.onAllNodes(
                    hasText(label),
                    useUnmergedTree = true,
                ).fetchSemanticsNodes().firstOrNull(),
            )
        }
    }

    // The square leg: a square display has the room for the full labels, so
    // the short forms are a round-only concession.
    @Test
    @Config(qualifiers = "w390dp-h390dp-notround")
    fun tennisSquare() {
        shot2x("square_tennis_2x") { tennis() }
        for (label in listOf("Next set", "Tiebreak")) {
            assertNotNull(
                "action label $label not rendered",
                composeRule.onAllNodes(
                    hasText(label),
                    useUnmergedTree = true,
                ).fetchSemanticsNodes().firstOrNull(),
            )
        }
    }

    @Test
    @Config(qualifiers = "w390dp-h390dp-notround")
    fun quickTennisSquare() {
        shot2x("square_quick_tennis_2x") { quickTennis() }
        for (label in listOf("Next set", "Tiebreak")) {
            assertNotNull(
                "quick action label $label not rendered",
                composeRule.onAllNodes(
                    hasText(label),
                    useUnmergedTree = true,
                ).fetchSemanticsNodes().firstOrNull(),
            )
        }
    }

    @Composable
    private fun quickTennis() = QuickScoreContent(
        state = WearFixtures.quickTennis,
        nowOverride = WearFixtures.now,
        onIncrementOne = {},
        onIncrementTwo = {},
        onDecrementOne = {},
        onDecrementTwo = {},
        onNextSet = {},
        onToggleTiebreak = {},
    )

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
     * large font scale used to draw the status over the clock. Matching the
     * text exactly also proves the compact form — not the full sentence that
     * happens to fit — is what rendered.
     */
    private fun assertStatusAboveClock(expectedStatus: String) {
        val status = composeRule.onAllNodes(
            hasText(expectedStatus),
            useUnmergedTree = true,
        ).fetchSemanticsNodes().firstOrNull()
        assertNotNull("\"$expectedStatus\" not rendered", status)
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
    private fun liveScore(state: ScoreUiState = WearFixtures.liveScore) =
        ScoreFixtureContent(
            state = state,
            now = WearFixtures.now,
            onIncrementOne = {},
            onIncrementTwo = {},
            onDecrementOne = {},
            onDecrementTwo = {},
            onUndo = {},
        )

    @Composable
    private fun tennis() = ScoreFixtureContent(
        state = WearFixtures.tennisScore,
        now = WearFixtures.now,
        onIncrementOne = {},
        onIncrementTwo = {},
        onDecrementOne = {},
        onDecrementTwo = {},
        onUndo = {},
    )
}
