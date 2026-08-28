package dev.convocados.ui.screen.history

import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextReplacement
import dev.convocados.data.api.SetScore
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class TennisSetEditorTest {
    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun `can add and edit tiebreak points for a set`() {
        val sets = mutableStateOf(listOf(SetScore(teamOne = 6, teamTwo = 6)))
        composeRule.setContent {
            MaterialTheme {
                TennisSetEditor(sets.value) { sets.value = it }
            }
        }

        composeRule.onNodeWithText("Add tiebreak").performClick()
        composeRule.onNodeWithText("Points 1").assertIsDisplayed()
        composeRule.onNodeWithText("Points 2").assertIsDisplayed()
        composeRule.onNodeWithText("Points 1").performTextReplacement("7")
        composeRule.onNodeWithText("Points 2").performTextReplacement("5")

        assertEquals(SetScore(6, 6, 7, 5), sets.value.single())
    }
}
