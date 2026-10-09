package dev.convocados.wear.ui.screen.teams

import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.hasScrollAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performScrollToNode
import dev.convocados.wear.data.local.entity.WearPlayerEntity
import dev.convocados.wear.ui.ROUND_LIST_INSET
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
import kotlin.math.abs

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
    fun `round roster rows are inset like the screen's other round-safe rows`() {
        render(liveRosterState())

        val roundSafeReference = scrollToAndGetBounds("reference row", hasText(KICK_OFF_BUTTON))
        assertRoundSafeReferenceIsInset(roundSafeReference)

        rosterRows().forEach { (label, matcher) ->
            assertRowMatchesReference(label, scrollToAndGetBounds(label, matcher), roundSafeReference)
        }
    }

    @Test
    @Config(qualifiers = "w390dp-h390dp-round")
    fun `round read-only, error and saving rows are inset like the round-safe rows`() {
        render(
            liveRosterState().copy(
                isReadOnly = true,
                isSaving = true,
                error = errorText,
            ),
        )

        val roundSafeReference = scrollToAndGetBounds("reference row", hasText(KICK_OFF_BUTTON))
        assertRoundSafeReferenceIsInset(roundSafeReference)

        assertRowMatchesReference("team one name", scrollToAndGetBounds("team one name", hasText(longTeamOneName)), roundSafeReference)
        assertRowMatchesReference("read-only player chip", scrollToAndGetBounds("read-only player chip", hasText(longNameOne)), roundSafeReference)
        assertRowMatchesReference("error message", scrollToAndGetBounds("error message", hasText(errorText)), roundSafeReference)
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
                TeamsScreen(
                    eventId = "event-1",
                    viewModel = teamsViewModel,
                    settingsViewModel = settingsViewModel,
                )
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
        composeRule.onNode(hasScrollAction()).performScrollToNode(matcher)
        composeRule.waitForIdle()
        return composeRule.onNode(matcher).fetchSemanticsNode().boundsInRoot
    }

    /**
     * Guards the reference itself: the "Kick off now" control must really be
     * inset from the raw list by at least the documented round list inset,
     * otherwise comparing against it proves nothing.
     */
    private fun assertRoundSafeReferenceIsInset(reference: Rect) {
        val list = composeRule.onNode(hasScrollAction()).fetchSemanticsNode().boundsInRoot
        val inset = with(composeRule.density) { ROUND_LIST_INSET.toPx() }
        val tolerance = 0.5f
        assertTrue(
            ("reference row is inset %.1fpx/%.1fpx from the list, expected at least %.1fpx on each " +
                "side — the reference is no longer round-safe")
                .format(reference.left - list.left, list.right - reference.right, inset - tolerance),
            reference.left - list.left >= inset - tolerance &&
                list.right - reference.right >= inset - tolerance,
        )
    }

    private fun assertRowMatchesReference(label: String, bounds: Rect, reference: Rect) {
        val tolerance = 0.5f
        assertTrue(
            ("%s spans [%.1f, %.1f], expected the round-safe band [%.1f, %.1f] — the row is laid " +
                "out at the bezel-crossing width on a round display")
                .format(label, bounds.left, bounds.right, reference.left, reference.right),
            abs(bounds.left - reference.left) <= tolerance &&
                abs(bounds.right - reference.right) <= tolerance,
        )
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
