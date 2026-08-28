package dev.convocados.ui.screen.event

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import dev.convocados.ui.theme.ConvocadosTheme
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class TeamEloTest {
    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun `team header displays total Elo`() {
        composeRule.setContent {
            ConvocadosTheme {
                TeamTotalElo(totalElo = 2180)
            }
        }

        composeRule.onNodeWithText("Total Elo: 2180").assertIsDisplayed()
    }
}
