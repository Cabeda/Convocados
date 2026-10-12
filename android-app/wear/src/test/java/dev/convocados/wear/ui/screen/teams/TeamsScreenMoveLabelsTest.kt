package dev.convocados.wear.ui.screen.teams

import androidx.compose.ui.test.hasScrollAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performScrollToNode
import dev.convocados.wear.data.local.entity.WearPlayerEntity
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
 * The move affordances used to say "→ Team 1" / "→ Team 2" no matter what the
 * event called its teams, so an organizer running "Ninjas vs Gunas" was asked
 * to move a player to a team that did not exist by that name.
 *
 * The invariant: every move label uses the team's real name from
 * [TeamsUiState], falling back to the generic label only when the event has
 * none.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class TeamsScreenMoveLabelsTest {

    @get:Rule
    val composeRule = createComposeRule()

    private val ninjas = player("p1", "teamOne", 0, "Ana Filipa Rodrigues")
    private val unassigned = player("u1", "unassigned", 0, "Carlos Eduardo Ferreira")

    @Test
    @Config(qualifiers = "w390dp-h390dp-round")
    fun `a player chip offers the opposite team's real name`() {
        render(
            TeamsUiState(
                teamOneName = "Ninjas",
                teamTwoName = "Gunas",
                teamOnePlayers = listOf(ninjas),
                isLoading = false,
            ),
        )

        scrollTo("→ Team Gunas")
        composeRule.onNodeWithText("→ Team Gunas").assertExists()
        composeRule.onNodeWithText("→ Team 2").assertDoesNotExist()
    }

    @Test
    @Config(qualifiers = "w390dp-h390dp-round")
    fun `a team-two player chip offers team one's real name`() {
        render(
            TeamsUiState(
                teamOneName = "Ninjas",
                teamTwoName = "Gunas",
                teamTwoPlayers = listOf(ninjas.copy(teamAssignment = "teamTwo")),
                isLoading = false,
            ),
        )

        scrollTo("→ Team Ninjas")
        composeRule.onNodeWithText("→ Team Ninjas").assertExists()
        composeRule.onNodeWithText("→ Team 1").assertDoesNotExist()
    }

    @Test
    @Config(qualifiers = "w227dp-h227dp-round")
    fun `the unassigned destinations are named after the teams`() {
        render(
            TeamsUiState(
                teamOneName = "Ninjas",
                teamTwoName = "Gunas",
                unassigned = listOf(unassigned),
                isLoading = false,
            ),
        )

        composeRule.onNode(hasText("Carlos Eduardo Ferreira")).assertExists()
        composeRule.onNode(hasText("→ Team Ninjas")).assertExists()
        composeRule.onNode(hasText("→ Team Gunas")).assertExists()
        composeRule.onNode(hasText("Team 1", substring = true)).assertDoesNotExist()
        composeRule.onNode(hasText("Team 2", substring = true)).assertDoesNotExist()
    }

    @Test
    @Config(qualifiers = "w390dp-h390dp-round")
    fun `an unnamed event still gets a usable label`() {
        render(
            TeamsUiState(
                teamOneName = "",
                teamTwoName = "",
                teamOnePlayers = listOf(ninjas),
                unassigned = listOf(unassigned),
                isLoading = false,
            ),
        )

        // Two nodes can legitimately carry this label here (the roster chip and
        // the unassigned destination), so assert on the set rather than a single
        // node and let the substring match exclude the "→ Team 1" variant.
        scrollTo("→ Team 2")
        assertTrue(
            "no fallback destination label is rendered",
            composeRule.onAllNodes(hasText("→ Team 2")).fetchSemanticsNodes().isNotEmpty(),
        )
        assertTrue(
            "the unassigned row lost its fallback labels",
            composeRule.onAllNodes(hasText("Team 1", substring = true)).fetchSemanticsNodes().isNotEmpty(),
        )
    }

    private fun scrollTo(text: String) {
        composeRule.onNode(hasScrollAction()).performScrollToNode(hasText(text, substring = true))
        composeRule.waitForIdle()
    }

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

    private fun player(id: String, team: String, order: Int, name: String) =
        WearPlayerEntity(id = id, eventId = "event-1", name = name, order = order, teamAssignment = team)
}
