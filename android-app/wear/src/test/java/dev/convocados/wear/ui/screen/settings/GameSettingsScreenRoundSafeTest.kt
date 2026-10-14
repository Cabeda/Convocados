package dev.convocados.wear.ui.screen.settings

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import dev.convocados.wear.ui.RoundSafeReferenceRow
import dev.convocados.wear.ui.assertEllipsised
import dev.convocados.wear.ui.assertFillsDisplay
import dev.convocados.wear.ui.assertNotLineLimited
import dev.convocados.wear.ui.assertRowInsideBezel
import dev.convocados.wear.ui.boundsOf
import dev.convocados.wear.ui.displayWidth
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

        assertRowInsideBezel(composeRule, "kickoff label", boundsOf(composeRule, "kickoff label", hasText(KICKOFF_LABEL, substring = true)))
        assertRowInsideBezel(composeRule, "kick off now", boundsOf(composeRule, "kick off now", hasText(KICK_OFF_NOW)))
        assertRowInsideBezel(composeRule, "keep screen on", boundsOf(composeRule, "keep screen on", hasText(KEEP_SCREEN_ON)))
        assertRowInsideBezel(composeRule, "vibration alerts", boundsOf(composeRule, "vibration alerts", hasText(VIBRATION_ALERTS)))
        assertRowInsideBezel(composeRule, "interval label", boundsOf(composeRule, "interval label", hasText(EVERY_LABEL)))
    }

    @Test
    @Config(qualifiers = "w390dp-h390dp-notround")
    fun `square settings rows keep filling the display`() {
        setContent()

        val width = displayWidth(composeRule)
        assertFillsDisplay("kickoff label", boundsOf(composeRule, "kickoff label", hasText(KICKOFF_LABEL, substring = true)), width)
        assertFillsDisplay("kick off now", boundsOf(composeRule, "kick off now", hasText(KICK_OFF_NOW)), width)
        assertFillsDisplay("keep screen on", boundsOf(composeRule, "keep screen on", hasText(KEEP_SCREEN_ON)), width)
        assertFillsDisplay("vibration alerts", boundsOf(composeRule, "vibration alerts", hasText(VIBRATION_ALERTS)), width)
        assertFillsDisplay("interval label", boundsOf(composeRule, "interval label", hasText(EVERY_LABEL)), width)
    }

    // GH #1276 review — the round bezel's ellipsis was applied on square
    // displays too, where the inset is a no-op and the text used to wrap.
    @Test
    @Config(qualifiers = "w390dp-h390dp-notround")
    fun `square settings labels keep their full line budget`() {
        setContent()

        assertNotLineLimited(composeRule, "kickoff label", hasText(KICKOFF_LABEL, substring = true))
        assertNotLineLimited(composeRule, "interval label", hasText(EVERY_LABEL))
    }

    @Test
    @Config(qualifiers = "w390dp-h390dp-round")
    fun `round settings labels stay on ellipsised lines`() {
        setContent()

        assertEllipsised(composeRule, "kickoff label", hasText(KICKOFF_LABEL, substring = true), roundLines = 2)
        assertEllipsised(composeRule, "interval label", hasText(EVERY_LABEL), roundLines = 1)
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

    private companion object {
        const val KICKOFF_LABEL = "Kickoff"
        const val KICK_OFF_NOW = "Kick off now"
        const val KEEP_SCREEN_ON = "Keep screen on"
        const val VIBRATION_ALERTS = "Vibration alerts"
        const val EVERY_LABEL = "Every"
    }
}
