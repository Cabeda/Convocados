package dev.convocados.wear.ui.screen.mvp

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import dev.convocados.wear.data.api.MvpParticipant
import dev.convocados.wear.data.api.MvpResponse
import dev.convocados.wear.ui.ROUND_SAFE_ANCHOR_LIST_TAG
import dev.convocados.wear.ui.RoundSafeReferenceRow
import dev.convocados.wear.ui.assertEllipsised
import dev.convocados.wear.ui.assertFillsDisplay
import dev.convocados.wear.ui.assertNotLineLimited
import dev.convocados.wear.ui.assertRowInsideBezel
import dev.convocados.wear.ui.assertWraps
import dev.convocados.wear.ui.boundsOf
import dev.convocados.wear.ui.displayWidth
import dev.convocados.wear.ui.screenList
import dev.convocados.wear.ui.theme.ConvocadosWearTheme
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.flow.MutableStateFlow
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * GH #1276 — the MVP rows (loading, prompt, error, eligibility and closing
 * texts) use `fillMaxWidth()` without `roundListInset()`, so on round displays
 * they are laid out at the bezel-crossing width and clipped by the screen's
 * `roundBezelClip()` once scrolled away from the equator.
 *
 * The invariant under test: every MVP row occupies exactly the band the
 * screen's round-safe controls live in (`Modifier.fillMaxWidth()
 * .roundListInset()`), and on a square display it keeps filling the display,
 * because the inset is a documented round-only no-op.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class MvpVotingScreenRoundSafeTest {

    @get:Rule
    val composeRule = createComposeRule()

    private val flow = MutableStateFlow(MvpVotingUiState())

    private val longNameOne = "Bernardo Maria Silva Carvalho e Sousa"
    private val longNameTwo = "Ana Filipa Rodrigues Mendes de Almeida"
    private val errorText =
        "Couldn't load voting. Check your connection and try again while the watch is offline"

    @Test
    @Config(qualifiers = "w390dp-h390dp-round")
    fun `round vote prompt row stays inside the round-safe band of the vote buttons`() {
        setContent()
        render(votingOpen())

        assertRowInsideBezel(composeRule, "vote button", boundsOf(composeRule, "vote button", hasText(longNameOne, substring = true)))
        assertRowInsideBezel(composeRule, "vote prompt", boundsOf(composeRule, "vote prompt", hasText(VOTE_PROMPT)))
    }

    @Test
    @Config(qualifiers = "w390dp-h390dp-round")
    fun `round closed and no-vote rows fill the round-safe band`() {
        setContent()
        render(votingClosed())

        assertRowInsideBezel(composeRule, "voting closed", boundsOf(composeRule, "voting closed", hasText(VOTING_CLOSED)))
        assertRowInsideBezel(composeRule, "no votes", boundsOf(composeRule, "no votes", hasText(NO_VOTES)))
    }

    @Test
    @Config(qualifiers = "w390dp-h390dp-round")
    fun `round loading and error rows fill the round-safe band`() {
        setContent()

        render(MvpVotingUiState(isLoading = true))
        assertRowInsideBezel(composeRule, "loading row", loadingRowBounds())

        render(MvpVotingUiState(isLoading = false, error = errorText))
        assertRowInsideBezel(composeRule, "error message", boundsOf(composeRule, "error message", hasText(errorText)))
    }

    @Test
    @Config(qualifiers = "w390dp-h390dp-round")
    fun `round not-eligible row fills the round-safe band`() {
        setContent()
        render(notEligible())

        assertRowInsideBezel(composeRule, "not eligible", boundsOf(composeRule, "not eligible", hasText(NOT_ELIGIBLE)))
    }

    @Test
    @Config(qualifiers = "w390dp-h390dp-notround")
    fun `square mvp rows keep filling the display`() {
        setContent()

        val width = displayWidth(composeRule)
        render(MvpVotingUiState(isLoading = true))
        assertFillsDisplay("loading row", loadingRowBounds(), width)

        render(votingClosed())
        assertFillsDisplay("voting closed", boundsOf(composeRule, "voting closed", hasText(VOTING_CLOSED)), width)
        assertFillsDisplay("no votes", boundsOf(composeRule, "no votes", hasText(NO_VOTES)), width)
    }

    // GH #1276 review — the ellipsis that keeps a long label off the round
    // bezel was applied on square displays too, where the inset is a no-op and
    // the text used to wrap. A square display must not be line-limited.
    @Test
    @Config(qualifiers = "w390dp-h390dp-notround")
    fun `square vote prompt and names keep their full line budget`() {
        setContent()
        render(votingOpen())

        assertNotLineLimited(composeRule, "vote prompt", hasText(VOTE_PROMPT))
        assertNotLineLimited(composeRule, "vote button", hasText(longNameOne, substring = true))
    }

    @Test
    @Config(qualifiers = "w390dp-h390dp-notround")
    fun `square long prompt wraps instead of being clipped`() {
        setContent()
        render(MvpVotingUiState(isLoading = false, error = errorText))

        assertWraps(composeRule, "error message", hasText(errorText, substring = true), atLeastLines = 2)
    }

    @Test
    @Config(qualifiers = "w390dp-h390dp-round")
    fun `round vote prompt and names stay on one ellipsised line`() {
        setContent()
        render(votingOpen())

        assertEllipsised(composeRule, "vote prompt", hasText(VOTE_PROMPT), roundLines = 1)
        assertEllipsised(composeRule, "vote button", hasText(longNameOne, substring = true), roundLines = 1)
    }

    // ── states ──────────────────────────────────────────────────────────

    private fun votingOpen() = MvpVotingUiState(
        eventId = EVENT_ID,
        historyId = HISTORY_ID,
        response = MvpResponse(
            isVotingOpen = true,
            hasVoted = false,
            participants = listOf(
                MvpParticipant("p1", longNameOne, 3),
                MvpParticipant("p2", longNameTwo, 1),
            ),
        ),
        isLoading = false,
    )

    private fun notEligible() = MvpVotingUiState(
        eventId = EVENT_ID,
        historyId = HISTORY_ID,
        response = MvpResponse(isVotingOpen = true, hasVoted = null),
        isLoading = false,
    )

    private fun votingClosed() = MvpVotingUiState(
        eventId = EVENT_ID,
        historyId = HISTORY_ID,
        response = MvpResponse(isVotingOpen = false, hasVoted = true),
        isLoading = false,
    )

    private fun setContent() {
        val viewModel = mockk<MvpVotingViewModel>(relaxed = true)
        every { viewModel.uiState } returns flow

        composeRule.setContent {
            ConvocadosWearTheme {
                Column(Modifier.fillMaxSize()) {
                    Box(Modifier.weight(1f)) {
                        MvpVotingScreen(
                            viewModel = viewModel,
                            eventId = EVENT_ID,
                            historyId = HISTORY_ID,
                        )
                    }
                    Box(Modifier.weight(1f)) { RoundSafeReferenceRow() }
                }
            }
        }
        composeRule.waitForIdle()
    }

    private fun render(newState: MvpVotingUiState) {
        flow.value = newState
        composeRule.waitForIdle()
    }

    // ── bounds ──────────────────────────────────────────────────────────

    private fun loadingRowBounds() =
        composeRule.onNodeWithTag(MVP_LOADING_ROW).fetchSemanticsNode().boundsInRoot

    private companion object {
        /** Mirrors the loading row's own private tag, which it keeps to itself. */
        const val MVP_LOADING_ROW = "mvp_voting_loading_row"
        const val EVENT_ID = "event-1"
        const val HISTORY_ID = "history-1"
        const val VOTE_PROMPT = "Vote for MVP"
        const val NOT_ELIGIBLE = "Only players in this game can vote"
        const val VOTING_CLOSED = "Voting closed"
        const val NO_VOTES = "No votes recorded"
    }
}
