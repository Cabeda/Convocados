package dev.convocados.ui.screen.seasons

import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import dev.convocados.data.api.CrewProposal
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
class PendingCrewProposalCardTest {

    @get:Rule
    val composeRule = createComposeRule()

    private val nomination = CrewProposal(
        id = "p1",
        name = "North",
        status = "pending",
        kind = "add",
        targetCrewId = "crew-1",
        targetCrewName = "North",
        captainNomination = true,
        awaitingMyAcceptance = true,
        proposerName = "Owner",
        memberNames = listOf("Player 1"),
    )

    @Test
    fun `a nomination offers the nominee Accept and never Approve`() {
        val decisions = mutableListOf<String>()

        composeRule.setContent {
            ConvocadosTheme {
                PendingCrewProposalCard(
                    proposal = nomination,
                    canReview = false,
                    busy = false,
                    onDecide = { decisions.add(it) },
                    onReject = {},
                )
            }
        }

        composeRule.onNodeWithText("Accept captaincy").performClick()

        assertEquals(listOf("accept"), decisions)
        composeRule.onNodeWithText("Approve").assertDoesNotExist()
    }

    @Test
    fun `an admin still reviews an ordinary proposal`() {
        val decisions = mutableListOf<String>()

        composeRule.setContent {
            ConvocadosTheme {
                PendingCrewProposalCard(
                    proposal = CrewProposal(
                        id = "p2",
                        name = "Rockets",
                        status = "pending",
                        proposerName = "Alice",
                        memberNames = listOf("Alice", "Bob", "Carol"),
                    ),
                    canReview = true,
                    busy = false,
                    onDecide = { decisions.add(it) },
                    onReject = {},
                )
            }
        }

        composeRule.onNodeWithText("Approve").performClick()

        assertEquals(listOf("approve"), decisions)
        composeRule.onNodeWithText("Accept captaincy").assertDoesNotExist()
    }
}
