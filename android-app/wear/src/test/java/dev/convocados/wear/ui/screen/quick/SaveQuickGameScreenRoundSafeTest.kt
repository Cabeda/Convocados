package dev.convocados.wear.ui.screen.quick

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.Modifier
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import dev.convocados.wear.data.local.QuickGameState
import dev.convocados.wear.data.local.entity.WearGameEntity
import dev.convocados.wear.ui.RoundSafeReferenceRow
import dev.convocados.wear.ui.assertEllipsised
import dev.convocados.wear.ui.assertFillsDisplay
import dev.convocados.wear.ui.assertNotLineLimited
import dev.convocados.wear.ui.assertRowFillsBand
import dev.convocados.wear.ui.boundsOf
import dev.convocados.wear.ui.displayWidth
import dev.convocados.wear.ui.roundSafeBand
import dev.convocados.wear.ui.theme.ConvocadosWearTheme
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

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

    private var state by mutableStateOf(eventsState())

    @Test
    @Config(qualifiers = "w390dp-h390dp-round")
    fun `round score and event rows fill the round-safe band`() {
        setContent()
        val band = roundSafeBand(composeRule)

        assertRowFillsBand("score summary", boundsOf(composeRule, "score summary", hasText(SCORE_SUMMARY)), band)
        assertRowFillsBand("event button", boundsOf(composeRule, "event button", hasText(EVENT_TITLE)), band)
    }

    @Test
    @Config(qualifiers = "w390dp-h390dp-round")
    fun `round saved, empty and error rows fill the round-safe band`() {
        setContent()

        state = SaveQuickGameUiState(saved = true)
        assertRowFillsBand("saved", boundsOf(composeRule, "saved", hasText(SAVED)), roundSafeBand(composeRule))

        state = SaveQuickGameUiState(
            quick = QuickGameState(scoreOne = 1, scoreTwo = 0),
            error = ERROR_TEXT,
        )
        val band = roundSafeBand(composeRule)
        assertRowFillsBand("no events", boundsOf(composeRule, "no events", hasText(NO_EVENTS)), band)
        assertRowFillsBand("error message", boundsOf(composeRule, "error message", hasText(ERROR_TEXT)), band)
    }

    @Test
    @Config(qualifiers = "w390dp-h390dp-notround")
    fun `square save rows keep filling the display`() {
        setContent()

        val width = displayWidth(composeRule)
        assertFillsDisplay("score summary", boundsOf(composeRule, "score summary", hasText(SCORE_SUMMARY)), width)
        assertFillsDisplay("event button", boundsOf(composeRule, "event button", hasText(EVENT_TITLE)), width)

        state = SaveQuickGameUiState(
            quick = QuickGameState(scoreOne = 1, scoreTwo = 0),
            error = ERROR_TEXT,
        )
        assertFillsDisplay("no events", boundsOf(composeRule, "no events", hasText(NO_EVENTS)), width)
    }

    // GH #1276 review — the round bezel's ellipsis was applied on square
    // displays too, where the inset is a no-op and the text used to wrap.
    @Test
    @Config(qualifiers = "w390dp-h390dp-notround")
    fun `square event button keeps its full line budget`() {
        setContent()

        assertNotLineLimited(composeRule, "event button", hasText(EVENT_TITLE))
    }

    @Test
    @Config(qualifiers = "w390dp-h390dp-round")
    fun `round event button stays on one ellipsised line`() {
        setContent()

        assertEllipsised(composeRule, "event button", hasText(EVENT_TITLE), roundLines = 1)
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

    private companion object {
        const val EVENT_TITLE = "Tuesday night football at the Julias"
        const val SCORE_SUMMARY = "Score 1 - 0"
        const val SAVED = "Saved"
        const val NO_EVENTS = "No compatible events available"
        const val ERROR_TEXT = "Couldn't save quick game. Check your connection and try again while offline"
    }
}
