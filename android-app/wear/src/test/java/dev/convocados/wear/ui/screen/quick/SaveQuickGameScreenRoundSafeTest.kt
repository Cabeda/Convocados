package dev.convocados.wear.ui.screen.quick

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Rect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.hasScrollAction
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performScrollToNode
import dev.convocados.wear.data.local.QuickGameState
import dev.convocados.wear.data.local.entity.WearGameEntity
import dev.convocados.wear.ui.ROUND_LIST_INSET
import dev.convocados.wear.ui.ROUND_SAFE_ANCHOR_LIST_TAG
import dev.convocados.wear.ui.ROUND_SAFE_ANCHOR_TAG
import dev.convocados.wear.ui.RoundSafeReferenceRow
import dev.convocados.wear.ui.theme.ConvocadosWearTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import kotlin.math.abs

/**
 * GH #1276 — the save-quick-game rows (score summary, event buttons, empty and
 * error texts, saved confirmation) use `fillMaxWidth()` without
 * `roundListInset()`, so on round displays they are laid out at the
 * bezel-crossing width and clipped by the screen's `roundBezelClip()` once
 * scrolled away from the equator.
 *
 * The invariant under test: every row occupies exactly the band a round-safe
 * row lives in (`Modifier.fillMaxWidth().roundListInset()`), and on a square
 * display it keeps filling the display, because the inset is a documented
 * round-only no-op.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class SaveQuickGameScreenRoundSafeTest {

    @get:Rule
    val composeRule = createComposeRule()

    /**
     * The screen's own list. The composition also renders the reference row's
     * list, which the anchor tag excludes.
     */
    private val screenList = hasScrollAction().and(hasTestTag(ROUND_SAFE_ANCHOR_LIST_TAG).not())

    private var state by mutableStateOf(eventsState())

    @Test
    @Config(qualifiers = "w390dp-h390dp-round")
    fun `round score and event rows fill the round-safe band`() {
        setContent()
        val band = roundSafeBand()

        assertRowFillsBand("score summary", boundsOf("score summary", hasText(SCORE_SUMMARY)), band)
        assertRowFillsBand("event button", boundsOf("event button", hasText(EVENT_TITLE)), band)
    }

    @Test
    @Config(qualifiers = "w390dp-h390dp-round")
    fun `round saved, empty and error rows fill the round-safe band`() {
        setContent()

        state = SaveQuickGameUiState(saved = true)
        assertRowFillsBand("saved", boundsOf("saved", hasText(SAVED)), roundSafeBand())

        state = SaveQuickGameUiState(
            quick = QuickGameState(scoreOne = 1, scoreTwo = 0),
            error = ERROR_TEXT,
        )
        val band = roundSafeBand()
        assertRowFillsBand("no events", boundsOf("no events", hasText(NO_EVENTS)), band)
        assertRowFillsBand("error message", boundsOf("error message", hasText(ERROR_TEXT)), band)
    }

    @Test
    @Config(qualifiers = "w390dp-h390dp-notround")
    fun `square save rows keep filling the display`() {
        setContent()

        val displayWidth = composeRule.onRoot().fetchSemanticsNode().size.width.toFloat()
        assertFillsDisplay("score summary", boundsOf("score summary", hasText(SCORE_SUMMARY)), displayWidth)
        assertFillsDisplay("event button", boundsOf("event button", hasText(EVENT_TITLE)), displayWidth)

        state = SaveQuickGameUiState(
            quick = QuickGameState(scoreOne = 1, scoreTwo = 0),
            error = ERROR_TEXT,
        )
        assertFillsDisplay("no events", boundsOf("no events", hasText(NO_EVENTS)), displayWidth)
    }

    // ── states ──────────────────────────────────────────────────────────

    private fun eventsState() = SaveQuickGameUiState(
        quick = QuickGameState(scoreOne = 1, scoreTwo = 0),
        events = listOf(
            WearGameEntity(
                id = "game-1",
                title = EVENT_TITLE,
                location = "",
                dateTime = "2026-08-28T10:30:00Z",
                sport = "football",
                maxPlayers = 10,
                playerCount = 8,
                teamOneName = "",
                teamTwoName = "",
                isRecurring = false,
                type = "owned",
            ),
        ),
    )

    private fun setContent() {
        composeRule.setContent {
            ConvocadosWearTheme {
                Column(Modifier.fillMaxSize()) {
                    Box(Modifier.weight(1f)) {
                        SaveQuickGameContent(state = state)
                    }
                    Box(Modifier.weight(1f)) { RoundSafeReferenceRow() }
                }
            }
        }
        composeRule.waitForIdle()
    }

    // ── bounds ──────────────────────────────────────────────────────────

    private fun boundsOf(label: String, matcher: SemanticsMatcher): Rect {
        composeRule.onNode(screenList).performScrollToNode(matcher)
        composeRule.waitForIdle()
        return composeRule.onNode(matcher).fetchSemanticsNode(label).boundsInRoot
    }

    /**
     * The band a round-safe row occupies, measured from the reference control.
     * Guarded on the reference really being inset from the list by the
     * documented round list inset, otherwise comparing against it proves
     * nothing.
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

    private companion object {
        const val EVENT_TITLE = "Tuesday night football at the Julias"
        const val SCORE_SUMMARY = "Score 1 - 0"
        const val SAVED = "Saved"
        const val NO_EVENTS = "No compatible events available"
        const val ERROR_TEXT = "Couldn't save quick game. Check your connection and try again while offline"

        /**
         * A blanket 20dp inset on both sides of a 390dp display would leave
         * ~79%; a correct square layout spans ~89%.
         */
        const val MIN_SQUARE_FILL_FRACTION = 0.85f
    }
}
