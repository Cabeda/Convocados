package dev.convocados.ui.screen.seasons

import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import dev.convocados.data.api.CrewCaptain
import dev.convocados.data.api.CrewCaptainMember
import dev.convocados.data.api.CrewProposalCandidate
import dev.convocados.ui.theme.ConvocadosTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "w411dp-h891dp")
class CaptainCrewToolsTest {

    @get:Rule
    val composeRule = createComposeRule()

    private val captain = CrewCaptain(
        crewId = "crew-1",
        crewName = "North",
        members = listOf(CrewCaptainMember(membershipId = "membership-1", name = "Player 1")),
    )
    private val candidates = listOf(
        CrewProposalCandidate(membershipId = "membership-9", name = "Player 9"),
        CrewProposalCandidate(userId = "user-7", name = "External player"),
    )
    private fun render(
        captain: CrewCaptain? = this.captain,
        submitted: Boolean = false,
        onSubmit: (String, String) -> Unit = { _, _ -> },
    ) {
        composeRule.setContent {
            ConvocadosTheme {
                CaptainCrewToolsSection(
                    captain = captain,
                    candidates = candidates,
                    busy = false,
                    submitted = submitted,
                    onSubmit = onSubmit,
                )
            }
        }
    }

    @Test
    fun `a captain can propose adding an unassigned participant`() {
        val submitted = mutableListOf<Pair<String, String>>()

        render(onSubmit = { action, membershipId -> submitted.add(action to membershipId) })

        composeRule.onNodeWithText("Select player").performClick()
        composeRule.onNodeWithText("Player 9").performClick()
        composeRule.onNodeWithText("Add player").performClick()

        assertEquals(listOf("add" to "membership-9"), submitted)
    }

    @Test
    fun `a captain can propose removing one of their crew members`() {
        val submitted = mutableListOf<Pair<String, String>>()

        render(onSubmit = { action, membershipId -> submitted.add(action to membershipId) })

        composeRule.onNodeWithText("Select player").performClick()
        composeRule.onNodeWithText("Player 1").performClick()
        composeRule.onNodeWithText("Remove player").performClick()

        assertEquals(listOf("remove" to "membership-1"), submitted)
    }

    @Test
    fun `a non-captain sees no captain tools`() {
        render(captain = null)

        composeRule.onNodeWithText("Captain tools").assertDoesNotExist()
        composeRule.onNodeWithText("Add player").assertDoesNotExist()
        composeRule.onNodeWithText("Remove player").assertDoesNotExist()
    }

    @Test
    fun `a submitted change tells the captain it awaits the organizer`() {
        render(submitted = true)

        composeRule.onNodeWithText("Sent to the organizer for approval.").assertExists()
    }
}
