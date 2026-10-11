package dev.convocados.wear.ui.screen.settings

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.hasScrollAction
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performScrollToNode
import dev.convocados.wear.ui.ROUND_LIST_INSET
import dev.convocados.wear.ui.ROUND_SAFE_ANCHOR_LIST_TAG
import dev.convocados.wear.ui.ROUND_SAFE_ANCHOR_TAG
import dev.convocados.wear.ui.RoundSafeReferenceRow
import dev.convocados.wear.ui.theme.ConvocadosWearTheme
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.flow.MutableStateFlow
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import kotlin.math.abs

/**
 * GH #1276 — the game-settings rows (kickoff label and button, both switches
 * and the vibration-interval block) use `fillMaxWidth()` without
 * `roundListInset()`, so on round displays they are laid out at the
 * bezel-crossing width and clipped by the screen's `roundBezelClip()` once
 * scrolled away from the equator.
 *
 * The invariant under test: every settings row occupies exactly the band a
 * round-safe row lives in (`Modifier.fillMaxWidth().roundListInset()`), and on
 * a square display it keeps filling the display, because the inset is a
 * documented round-only no-op.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class GameSettingsScreenRoundSafeTest {

    @get:Rule
    val composeRule = createComposeRule()

    /**
     * The screen's own list. The composition also renders the reference row's
     * list, which the anchor tag excludes.
     */
    private val screenList = hasScrollAction().and(hasTestTag(ROUND_SAFE_ANCHOR_LIST_TAG).not())

    private val flow = MutableStateFlow(
        GameSettingsUiState(
            isLoading = false,
            canScheduleExact = true,
            keepScreenOn = true,
            vibrationEnabled = true,
            vibrationIntervalMinutes = 5,
        ),
    )

    @Test
    @Config(qualifiers = "w390dp-h390dp-round")
    fun `round kickoff, switch and vibration rows fill the round-safe band`() {
        setContent()
        val band = roundSafeBand()

        assertRowFillsBand("kickoff label", boundsOf("kickoff label", hasText(KICKOFF_LABEL, substring = true)), band)
        assertRowFillsBand("kick off now", boundsOf("kick off now", hasText(KICK_OFF_NOW)), band)
        assertRowFillsBand("keep screen on", boundsOf("keep screen on", hasText(KEEP_SCREEN_ON)), band)
        assertRowFillsBand("vibration alerts", boundsOf("vibration alerts", hasText(VIBRATION_ALERTS)), band)
        assertRowFillsBand("interval label", boundsOf("interval label", hasText(EVERY_LABEL)), band)
    }

    @Test
    @Config(qualifiers = "w390dp-h390dp-notround")
    fun `square settings rows keep filling the display`() {
        setContent()

        val displayWidth = composeRule.onRoot().fetchSemanticsNode().size.width.toFloat()
        assertFillsDisplay("kickoff label", boundsOf("kickoff label", hasText(KICKOFF_LABEL, substring = true)), displayWidth)
        assertFillsDisplay("kick off now", boundsOf("kick off now", hasText(KICK_OFF_NOW)), displayWidth)
        assertFillsDisplay("keep screen on", boundsOf("keep screen on", hasText(KEEP_SCREEN_ON)), displayWidth)
        assertFillsDisplay("vibration alerts", boundsOf("vibration alerts", hasText(VIBRATION_ALERTS)), displayWidth)
        assertFillsDisplay("interval label", boundsOf("interval label", hasText(EVERY_LABEL)), displayWidth)
    }

    // ── render ──────────────────────────────────────────────────────────

    private fun setContent() {
        val viewModel = mockk<GameSettingsViewModel>(relaxed = true)
        every { viewModel.uiState } returns flow

        composeRule.setContent {
            ConvocadosWearTheme {
                Column(Modifier.fillMaxSize()) {
                    Box(Modifier.weight(1f)) {
                        GameSettingsScreen(eventId = "event-1", viewModel = viewModel)
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
     * documented [ROUND_LIST_INSET], otherwise comparing against it proves
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
        const val KICKOFF_LABEL = "Kickoff"
        const val KICK_OFF_NOW = "Kick off now"
        const val KEEP_SCREEN_ON = "Keep screen on"
        const val VIBRATION_ALERTS = "Vibration alerts"
        const val EVERY_LABEL = "Every"

        /**
         * A blanket 20dp inset on both sides of a 390dp display would leave
         * ~79%; a correct square layout spans ~89%.
         */
        const val MIN_SQUARE_FILL_FRACTION = 0.85f
    }
}
