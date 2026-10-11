package dev.convocados.wear.ui.screen.mvp

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.hasScrollAction
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performScrollToNode
import dev.convocados.wear.data.api.MvpParticipant
import dev.convocados.wear.data.api.MvpResponse
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.style.TextOverflow
import dev.convocados.wear.ui.ROUND_LIST_INSET
import dev.convocados.wear.ui.ROUND_SAFE_ANCHOR_LIST_TAG
import dev.convocados.wear.ui.ROUND_SAFE_ANCHOR_TAG
import dev.convocados.wear.ui.RoundSafeReferenceRow
import dev.convocados.wear.ui.theme.ConvocadosWearTheme
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.flow.MutableStateFlow
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import kotlin.math.abs

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

    /**
     * The screen's own list. The composition also renders the reference row's
     * list, which the anchor tag excludes.
     */
    private val screenList = hasScrollAction().and(hasTestTag(ROUND_SAFE_ANCHOR_LIST_TAG).not())

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

        val band = roundSafeBand()
        assertRowFillsBand("vote button", boundsOf("vote button", hasText(longNameOne, substring = true)), band)
        assertRowInsideBand("vote prompt", boundsOf("vote prompt", hasText(VOTE_PROMPT)), band)
    }

    @Test
    @Config(qualifiers = "w390dp-h390dp-round")
    fun `round closed and no-vote rows fill the round-safe band`() {
        setContent()
        render(votingClosed())

        val band = roundSafeBand()
        assertRowFillsBand("voting closed", boundsOf("voting closed", hasText(VOTING_CLOSED)), band)
        assertRowFillsBand("no votes", boundsOf("no votes", hasText(NO_VOTES)), band)
    }

    @Test
    @Config(qualifiers = "w390dp-h390dp-round")
    fun `round loading and error rows fill the round-safe band`() {
        setContent()

        render(MvpVotingUiState(isLoading = true))
        assertRowFillsBand("loading row", loadingRowBounds(), roundSafeBand())

        render(MvpVotingUiState(isLoading = false, error = errorText))
        assertRowFillsBand("error message", boundsOf("error message", hasText(errorText)), roundSafeBand())
    }

    @Test
    @Config(qualifiers = "w390dp-h390dp-round")
    fun `round not-eligible row fills the round-safe band`() {
        setContent()
        render(notEligible())

        assertRowFillsBand("not eligible", boundsOf("not eligible", hasText(NOT_ELIGIBLE)), roundSafeBand())
    }

    @Test
    @Config(qualifiers = "w390dp-h390dp-notround")
    fun `square mvp rows keep filling the display`() {
        setContent()

        val displayWidth = composeRule.onRoot().fetchSemanticsNode().size.width.toFloat()
        render(MvpVotingUiState(isLoading = true))
        assertFillsDisplay("loading row", loadingRowBounds(), displayWidth)

        render(votingClosed())
        assertFillsDisplay("voting closed", boundsOf("voting closed", hasText(VOTING_CLOSED)), displayWidth)
        assertFillsDisplay("no votes", boundsOf("no votes", hasText(NO_VOTES)), displayWidth)
    }

    // GH #1276 review — the ellipsis that keeps a long label off the round
    // bezel was applied on square displays too, where the inset is a no-op and
    // the text used to wrap. A square display must not be line-limited.
    @Test
    @Config(qualifiers = "w390dp-h390dp-notround")
    fun `square vote prompt and names keep their full line budget`() {
        setContent()
        render(votingOpen())

        assertNotLineLimited("vote prompt", hasText(VOTE_PROMPT))
        assertNotLineLimited("vote button", hasText(longNameOne, substring = true))
    }

    @Test
    @Config(qualifiers = "w390dp-h390dp-notround")
    fun `square long prompt wraps instead of being clipped`() {
        setContent()
        render(MvpVotingUiState(isLoading = false, error = errorText))

        assertWraps("error message", hasText(errorText, substring = true), atLeastLines = 2)
    }

    @Test
    @Config(qualifiers = "w390dp-h390dp-round")
    fun `round vote prompt and names stay on one ellipsised line`() {
        setContent()
        render(votingOpen())

        assertEllipsised("vote prompt", hasText(VOTE_PROMPT), roundLines = 1)
        assertEllipsised("vote button", hasText(longNameOne, substring = true), roundLines = 1)
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

    private fun loadingRowBounds(): Rect =
        composeRule.onNodeWithTag(MVP_LOADING_ROW).fetchSemanticsNode().boundsInRoot

    private fun boundsOf(label: String, matcher: SemanticsMatcher): Rect {
        composeRule.onNode(screenList).performScrollToNode(matcher)
        composeRule.waitForIdle()
        return composeRule.onNode(matcher).fetchSemanticsNode(label).boundsInRoot
    }

    /**
     * The band the screen's round-safe rows occupy, measured from the
     * reference control. Guarded on the reference really being inset from the
     * list by the documented [ROUND_LIST_INSET], otherwise comparing against it
     * proves nothing.
     */
    private fun roundSafeBand(): Rect {
        val band = composeRule.onNodeWithTag(ROUND_SAFE_ANCHOR_TAG).fetchSemanticsNode().boundsInRoot
        val list = composeRule.onNode(screenList).fetchSemanticsNode().boundsInRoot
        val inset = with(composeRule.density) { ROUND_LIST_INSET.toPx() }
        val tolerance = 0.5f
        assertTrue(
            ("reference row is inset %.1fpx/%.1fpx from the list, expected at least %.1fpx on each side " +
                "— the reference is no longer round-safe")
                .format(band.left - list.left, list.right - band.right, inset - tolerance),
            band.left - list.left >= inset - tolerance && list.right - band.right >= inset - tolerance,
        )
        return band
    }

    private fun assertRowFillsBand(label: String, bounds: Rect, band: Rect) {
        val tolerance = 0.5f
        assertTrue(
            ("%s spans [%.1f, %.1f], expected the round-safe band [%.1f, %.1f] — the row is laid out " +
                "at the bezel-crossing width on a round display")
                .format(label, bounds.left, bounds.right, band.left, band.right),
            abs(bounds.left - band.left) <= tolerance && abs(bounds.right - band.right) <= tolerance,
        )
    }

    private fun assertRowInsideBand(label: String, bounds: Rect, band: Rect) {
        val tolerance = 0.5f
        assertTrue(
            ("%s spans [%.1f, %.1f], expected inside the round-safe band [%.1f, %.1f] — the row " +
                "crosses the circular bezel")
                .format(label, bounds.left, bounds.right, band.left, band.right),
            bounds.left >= band.left - tolerance && bounds.right <= band.right + tolerance,
        )
    }

    /**
     * The inset is a no-op on square displays, so the rows must still fill the
     * display there — the fix must not shrink every form factor.
     */
    private fun assertFillsDisplay(label: String, bounds: Rect, displayWidth: Float) {
        val fraction = bounds.width / displayWidth
        assertTrue(
            ("%s spans %.1f%% of the display width, expected at least %.1f%% — the round-only inset " +
                "must not be applied on square displays")
                .format(label, fraction * 100, MIN_SQUARE_FILL_FRACTION * 100),
            fraction >= MIN_SQUARE_FILL_FRACTION,
        )
    }

    // ── line budget ─────────────────────────────────────────────────────

    /**
     * How the label actually laid out. A clipped text still reports the whole
     * string in its semantics, so the ellipsis is only visible here.
     */
    private fun textLayout(label: String, matcher: SemanticsMatcher): TextLayoutResult {
        composeRule.onNode(screenList).performScrollToNode(matcher)
        composeRule.waitForIdle()
        val node = composeRule.onNode(matcher).fetchSemanticsNode(label)
        val results = mutableListOf<TextLayoutResult>()
        node.config[SemanticsActions.GetTextLayoutResult].action?.invoke(results)
        return results.firstOrNull()
            ?: throw AssertionError("$label carries no text layout, so its clipping cannot be measured")
    }

    /**
     * The ellipsis is a round-only affordance: on a square display the row is
     * full width and the label must keep the default budget, wrapping as it
     * did before the inset fix.
     */
    private fun assertNotLineLimited(label: String, matcher: SemanticsMatcher) {
        val layout = textLayout(label, matcher)
        assertEquals(
            "$label is limited to ${layout.layoutInput.maxLines} line(s) on a square display — " +
                "the round-only ellipsis clips text that used to wrap",
            Int.MAX_VALUE,
            layout.layoutInput.maxLines,
        )
        assertEquals(
            "$label clips on a square display",
            TextOverflow.Clip,
            layout.layoutInput.overflow,
        )
    }

    /** A long prompt really does get its second line on a square display. */
    private fun assertWraps(label: String, matcher: SemanticsMatcher, atLeastLines: Int) {
        val layout = textLayout(label, matcher)
        assertTrue(
            ("%s laid out on %d line(s), expected at least %d — the text is clipped before it " +
                "can wrap")
                .format(label, layout.lineCount, atLeastLines),
            layout.lineCount >= atLeastLines,
        )
    }

    /** The round half of the same bargain: one ellipsised line at most. */
    private fun assertEllipsised(label: String, matcher: SemanticsMatcher, roundLines: Int) {
        val layout = textLayout(label, matcher)
        assertEquals(
            "$label must be ellipsised on a round display",
            TextOverflow.Ellipsis,
            layout.layoutInput.overflow,
        )
        assertTrue(
            "$label is allowed ${layout.layoutInput.maxLines} line(s), expected at most $roundLines",
            layout.layoutInput.maxLines <= roundLines,
        )
    }

    private companion object {
        const val EVENT_ID = "event-1"
        const val HISTORY_ID = "history-1"
        const val VOTE_PROMPT = "Vote for MVP"
        const val NOT_ELIGIBLE = "Only players in this game can vote"
        const val VOTING_CLOSED = "Voting closed"
        const val NO_VOTES = "No votes recorded"

        /**
         * A blanket 20dp inset on both sides of a 390dp display would leave
         * ~79%; a correct square layout spans ~89%.
         */
        const val MIN_SQUARE_FILL_FRACTION = 0.85f
    }
}
