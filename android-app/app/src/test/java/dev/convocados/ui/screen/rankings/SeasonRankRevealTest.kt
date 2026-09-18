package dev.convocados.ui.screen.rankings

import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import dev.convocados.data.api.SeasonRankMovement
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "w411dp-h891dp")
class SeasonRankRevealTest {
    @get:Rule
    val composeRule = createComposeRule()

    private val rank = SeasonRankMovement(
        seasonId = "s1",
        seasonName = "Spring Season",
        counted = true,
        delta = 32.0,
        before = 1500.0,
        after = 1532.0,
        tierBefore = 1,
        tierAfter = 1,
        provisional = false,
        gamesThisSeason = 5,
        edges = listOf(0.0, 1000.0, 1600.0, 2000.0, 2300.0, 2600.0),
    )

    @Test
    fun `shows before after delta and tier and fires the why callback`() {
        var clicked = false
        composeRule.setContent {
            MaterialTheme { SeasonRankReveal(rank, onWhyClick = { clicked = true }, onDismiss = {}) }
        }
        composeRule.onNodeWithText("1500").assertIsDisplayed()
        composeRule.onNodeWithText("1532").assertIsDisplayed()
        composeRule.onNodeWithText("+32 RP").assertIsDisplayed()
        composeRule.onNodeWithText("Silver", useUnmergedTree = true).assertIsDisplayed()
        composeRule.onNodeWithText("Why?").performClick()
        assertTrue(clicked)
    }

    @Test
    fun `fires the dismiss callback when Got it is tapped`() {
        var dismissed = false
        composeRule.setContent {
            MaterialTheme { SeasonRankReveal(rank, onWhyClick = {}, onDismiss = { dismissed = true }) }
        }
        composeRule.onNodeWithText("Got it").performClick()
        assertTrue(dismissed)
    }

    @Test
    fun `shows the unlock counter instead of progress when provisional`() {
        composeRule.setContent {
            MaterialTheme {
                SeasonRankReveal(
                    rank.copy(provisional = true, before = 868.0, after = 900.0, tierAfter = 0, gamesThisSeason = 2),
                    onWhyClick = {},
                    onDismiss = {},
                )
            }
        }
        composeRule.onNodeWithText("Rank unlocks at 3 games — 2/3").assertIsDisplayed()
    }

    @Test
    fun `renders nothing when the game did not count`() {
        composeRule.setContent {
            MaterialTheme { SeasonRankReveal(rank.copy(counted = false), onWhyClick = {}, onDismiss = {}) }
        }
        composeRule.onNodeWithTag("season_rank_reveal").assertDoesNotExist()
    }
}
