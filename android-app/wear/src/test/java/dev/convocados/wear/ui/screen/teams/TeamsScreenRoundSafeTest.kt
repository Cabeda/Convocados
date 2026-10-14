package dev.convocados.wear.ui.screen.teams

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.hasScrollAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performScrollToNode
import dev.convocados.wear.data.local.entity.WearPlayerEntity
import dev.convocados.wear.ui.RoundSafeReferenceRow
import dev.convocados.wear.ui.assertRowInsideBezel
import dev.convocados.wear.ui.screenList
import dev.convocados.wear.ui.screen.settings.GameSettingsUiState
import dev.convocados.wear.ui.screen.settings.GameSettingsViewModel
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

/**
 * GH #992 — team-name Texts and roster rows use `fillMaxWidth()` without
 * `roundListInset()`, so on round displays they are laid out at the
 * bezel-crossing width the list hands them instead of the round-safe width.
 * The screen's `roundBezelClip` then hides the overflow, so the organizer reads
 * a name that has been clipped mid-word.
 *
 * The invariant under test: on a round display a roster row must occupy exactly
 * the same horizontal band as the screen's already round-safe control
 * (`Modifier.fillMaxWidth().roundListInset()`), and on a square display it must
 * keep filling the list, because there the inset is a documented no-op.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class TeamsScreenRoundSafeTest {

    @get:Rule
    val composeRule = createComposeRule()

    // Names long enough to force ellipsis, so a row's measured width reveals
    // the width it was actually given rather than the width of its glyphs.
    private val longTeamOneName = "Real Sporting Clube de Braga"
    private val longTeamTwoName = "Futebol Clube do Porto Alegre"
    private val longNameOne = "Bernardo Maria Silva Carvalho e Sousa"
    private val longNameTwo = "Ana Filipa Rodrigues Mendes de Almeida"
    private val longNameThree = "Carlos Eduardo Ferreira Pires da Cunha"
    private val longNameFour = "Daniela Sofia Goncalves Costa Pinto"
    private val errorText = "Failed to update teams — the server rejected this roster change"

    @Test
    @Config(qualifiers = "w390dp-h390dp-round")
    fun `round roster rows keep their corners inside the round bezel`() {
        render(liveRosterState())


        rosterRows().forEach { (label, matcher) ->
            assertRowInsideBezel(composeRule, label, scrollToAndGetBounds(label, matcher))
        }
    }

    @Test
    @Config(qualifiers = "w390dp-h390dp-round")
    fun `round read-only, error and saving rows keep their corners inside the round bezel`() {
        render(
            liveRosterState().copy(
                isReadOnly = true,
                isSaving = true,
                error = errorText,
            ),
        )


        assertRowInsideBezel(composeRule, "team one name", scrollToAndGetBounds("team one name", hasText(longTeamOneName)))
        assertRowInsideBezel(composeRule, "read-only player chip", scrollToAndGetBounds("read-only player chip", hasText(longNameOne)))
        assertRowInsideBezel(composeRule, "error message", scrollToAndGetBounds("error message", hasText(errorText)))
    }

    /**
     * The inset is a no-op on square displays, so the roster must still fill
     * the display there — the fix must not shrink every form factor.
     */
    @Test
    @Config(qualifiers = "w390dp-h390dp-notround")
    fun `square roster rows keep filling the display`() {
        render(liveRosterState())

        val displayWidth = composeRule.onRoot().fetchSemanticsNode().size.width.toFloat()
        rosterRows().forEach { (label, matcher) ->
            val bounds = scrollToAndGetBounds(label, matcher)
            val fraction = bounds.width / displayWidth
            assertTrue(
                ("%s spans %.1f%% of the display width, expected >= %.1f%% — the round-only " +
                    "inset must not be applied on square displays")
                    .format(label, fraction * 100, MIN_SQUARE_FILL_FRACTION * 100),
                fraction >= MIN_SQUARE_FILL_FRACTION,
            )
        }
    }

    // ── helpers ──────────────────────────────────────────────────────────

    private fun liveRosterState() = TeamsUiState(
        teamOneName = longTeamOneName,
        teamTwoName = longTeamTwoName,
        teamOnePlayers = listOf(
            player("p1", "teamOne", 0, longNameOne),
            player("p2", "teamOne", 1, longNameTwo),
        ),
        unassigned = listOf(player("u1", "unassigned", 0, longNameThree)),
        bench = listOf(player("b1", "bench", 0, longNameFour)),
        isLoading = false,
    )

    private fun player(id: String, team: String, order: Int, name: String) =
        WearPlayerEntity(id = id, eventId = "event-1", name = name, order = order, teamAssignment = team)

    private fun render(state: TeamsUiState) {
        val teamsViewModel = mockk<TeamsViewModel>(relaxed = true)
        every { teamsViewModel.uiState } returns MutableStateFlow(state)
        val settingsViewModel = mockk<GameSettingsViewModel>(relaxed = true)
        every { settingsViewModel.uiState } returns
            MutableStateFlow(GameSettingsUiState(isLoading = false, canScheduleExact = true))

        composeRule.setContent {
            ConvocadosWearTheme {
                Box(Modifier.fillMaxSize()) {
                    TeamsScreen(
                        eventId = "event-1",
                        viewModel = teamsViewModel,
                        settingsViewModel = settingsViewModel,
                    )
                    // Overlaid rather than stacked: splitting the display in
                    // half would leave the roster unable to scroll to its own
                    // rows, and `matchParentSize` keeps the screen's layout
                    // untouched while still giving the ceiling a measurement.
                    Box(Modifier.matchParentSize()) { RoundSafeReferenceRow() }
                }
            }
        }
        composeRule.waitForIdle()
    }

    private fun rosterRows(): List<Pair<String, SemanticsMatcher>> = listOf(
        "team one name" to hasText(longTeamOneName),
        "team two name" to hasText(longTeamTwoName),
        "team one player chip" to hasText(longNameOne),
        "team one second chip" to hasText(longNameTwo),
        "unassigned header" to hasText(UNASSIGNED),
        "unassigned player chip" to hasText(longNameThree),
        "bench header" to hasText(BENCH),
        "bench name" to hasText(longNameFour),
    )

    private fun scrollToAndGetBounds(label: String, matcher: SemanticsMatcher): Rect {
        composeRule.onNode(screenList()).performScrollToNode(matcher)
        composeRule.waitForIdle()
        return composeRule.onNode(matcher).fetchSemanticsNode().boundsInRoot
    }

    private companion object {
        const val KICK_OFF_BUTTON = "Kick off now"
        const val UNASSIGNED = "Unassigned"
        const val BENCH = "Bench"

        /**
         * A blanket 20dp inset on both sides of a 390dp display would leave
         * ~79%; a correct square layout spans ~89%.
         */
        const val MIN_SQUARE_FILL_FRACTION = 0.85f
    }
}
