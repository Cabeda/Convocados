package dev.convocados.wear.ui.screen.score

import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import dev.convocados.wear.ui.MIN_TOUCH_TARGET
import dev.convocados.wear.ui.fixture.WearFixtures
import dev.convocados.wear.ui.theme.ConvocadosWearTheme
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.MutableSharedFlow
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.time.Instant
import java.time.temporal.ChronoUnit

/**
 * "Open teams" was a `CompactButton` floating in a `padding(16.dp)` column, so
 * it rendered about 100dp wide on a 225dp round watch — the narrowest thing on
 * a screen whose whole point is to reach the roster.
 *
 * The invariant: every action on the score screen's pre-game and pre-start
 * states is a real target, at least [MIN_TOUCH_TARGET] in both dimensions.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class ScoreScreenTeamsActionTest {

    @get:Rule
    val composeRule = createComposeRule()

    @Test
    @Config(qualifiers = "w227dp-h227dp-round")
    fun `open teams on an upcoming game is a full-width target`() {
        val start = Instant.now().plus(3, ChronoUnit.HOURS)
        render(
            WearFixtures.liveScore.copy(
                game = WearFixtures.liveScore.game!!.copy(dateTime = start.toString()),
                kickoffEpochMs = start.toEpochMilli(),
                history = null,
            ),
        )

        assertTarget("open teams", hasText("Open teams"))
    }

    @Test
    @Config(qualifiers = "w227dp-h227dp-round")
    fun `teams on a game awaiting a score is a full-width target`() {
        val kickoff = Instant.now()
        render(
            WearFixtures.liveScore.copy(
                game = WearFixtures.liveScore.game!!.copy(dateTime = kickoff.toString()),
                kickoffEpochMs = kickoff.toEpochMilli(),
                history = null,
            ),
        )

        assertTarget("teams", hasText("Teams"))
    }

    private fun assertTarget(label: String, matcher: SemanticsMatcher) {
        composeRule.waitForIdle()
        val nodes = composeRule.onAllNodes(matcher and hasClickAction()).fetchSemanticsNodes()
        assertTrue("$label is not rendered as an action", nodes.isNotEmpty())
        val floor = with(composeRule.density) { MIN_TOUCH_TARGET.toPx() }
        val tolerance = 0.5f
        nodes.forEach { node ->
            val widthDp = with(composeRule.density) { node.size.width.toDp() }
            val heightDp = with(composeRule.density) { node.size.height.toDp() }
            assertTrue(
                ("%s is laid out %.1fdp x %.1fdp, expected at least %.1fdp in both dimensions")
                    .format(label, widthDp.value, heightDp.value, MIN_TOUCH_TARGET.value),
                node.size.width >= floor - tolerance && node.size.height >= floor - tolerance,
            )
        }
    }

    private fun render(state: ScoreUiState) {
        val viewModel = mockk<ScoreViewModel>(relaxed = true)
        every { viewModel.uiState } returns MutableStateFlow(state)
        every { viewModel.tierUp } returns MutableSharedFlow()
        composeRule.setContent {
            ConvocadosWearTheme {
                ScoreScreen(eventId = "event-1", viewModel = viewModel)
            }
        }
        composeRule.waitForIdle()
    }
}
