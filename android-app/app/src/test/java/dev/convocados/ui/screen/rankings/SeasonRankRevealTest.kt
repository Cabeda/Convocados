package dev.convocados.ui.screen.rankings

import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import dev.convocados.data.api.SeasonRankMovement
import dev.convocados.data.api.SeasonRankStanding
import dev.convocados.data.api.ViewerCrewStanding
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

    private val standing = SeasonRankStanding(
        seasonId = "s1",
        seasonName = "Spring Season",
        rank = 1168.0,
        tier = 4,
        provisional = false,
        gamesThisSeason = 5,
        edges = listOf(0.0, 200.0, 400.0, 800.0, 900.0, 1300.0),
        crew = ViewerCrewStanding(
            crewId = "c1",
            name = "Vermelhos",
            place = 1,
            placeCount = 2,
            points = 10.0,
            pointsDelta = 3.0,
        ),
    )

    @Test
    fun `shows the settled rank, delta and tier and fires the why callback`() {
        var clicked = false
        composeRule.setContent {
            MaterialTheme {
                SeasonRankReveal(
                    rank = rank,
                    standing = standing,
                    onWhyClick = { clicked = true },
                    onViewSeason = {},
                    onDismiss = {},
                    animate = false,
                )
            }
        }
        composeRule.onNodeWithText("RANK UPDATED").assertIsDisplayed()
        composeRule.onNodeWithText("1532").assertIsDisplayed()
        composeRule.onNodeWithText("+32 RP").assertIsDisplayed()
        composeRule.onNodeWithText("Silver", useUnmergedTree = true).assertIsDisplayed()
        composeRule.onNodeWithText("How rank works").performClick()
        assertTrue(clicked)
    }

    @Test
    fun `fires the dismiss callback when the dismiss button is tapped`() {
        var dismissed = false
        composeRule.setContent {
            MaterialTheme {
                SeasonRankReveal(
                    rank = rank,
                    standing = null,
                    onWhyClick = {},
                    onViewSeason = {},
                    onDismiss = { dismissed = true },
                    animate = false,
                )
            }
        }
        composeRule.onNodeWithContentDescription("Dismiss Rank").performClick()
        assertTrue(dismissed)
    }

    @Test
    fun `shows the unlock counter instead of progress when provisional`() {
        composeRule.setContent {
            MaterialTheme {
                SeasonRankReveal(
                    rank = rank.copy(provisional = true, before = 868.0, after = 900.0, tierAfter = 0, gamesThisSeason = 2),
                    standing = null,
                    onWhyClick = {},
                    onViewSeason = {},
                    onDismiss = {},
                    animate = false,
                )
            }
        }
        composeRule.onNodeWithText("Rank unlocks at 3 games — 2/3").assertIsDisplayed()
    }

    @Test
    fun `standing without a counted rank shows rank standing, no delta and the score cue`() {
        composeRule.setContent {
            MaterialTheme {
                SeasonRankReveal(
                    rank = null,
                    standing = standing,
                    onWhyClick = {},
                    onViewSeason = {},
                    onDismiss = {},
                    animate = false,
                )
            }
        }
        composeRule.onNodeWithTag("season_rank_reveal").assertIsDisplayed()
        composeRule.onNodeWithText("RANK STANDING").assertIsDisplayed()
        composeRule.onNodeWithText("1168").assertIsDisplayed()
        composeRule.onNodeWithText("+32 RP").assertDoesNotExist()
        composeRule.onNodeWithTag("season_rank_cue").assertIsDisplayed()
        composeRule.onNodeWithText("This game updates your Rank — enter the score first").assertIsDisplayed()
        composeRule.onNodeWithText("View season").assertIsDisplayed()
    }

    @Test
    fun `hides the tier bar at the top tier and shows a plain top tier label`() {
        composeRule.setContent {
            MaterialTheme {
                SeasonRankReveal(
                    rank = null,
                    standing = standing.copy(edges = listOf(0.0, 200.0, 400.0, 800.0, 900.0, 1300.0), tier = 5, rank = 1344.0),
                    onWhyClick = {},
                    onViewSeason = {},
                    onDismiss = {},
                    animate = false,
                )
            }
        }
        composeRule.onNodeWithTag("season_rank_progress").assertDoesNotExist()
        composeRule.onNodeWithText("Top tier").assertIsDisplayed()
    }

    @Test
    fun `shows a tier bar while a tier is still ahead`() {
        composeRule.setContent {
            MaterialTheme {
                SeasonRankReveal(
                    rank = null,
                    standing = standing,
                    onWhyClick = {},
                    onViewSeason = {},
                    onDismiss = {},
                    animate = false,
                )
            }
        }
        composeRule.onNodeWithTag("season_rank_progress").assertIsDisplayed()
        composeRule.onNodeWithText("132 RP to Master").assertIsDisplayed()
    }

    @Test
    fun `shows the crew place, points and game points delta chip`() {
        composeRule.setContent {
            MaterialTheme {
                SeasonRankReveal(
                    rank = rank,
                    standing = standing,
                    onWhyClick = {},
                    onViewSeason = {},
                    onDismiss = {},
                    animate = false,
                )
            }
        }
        composeRule.onNodeWithTag("season_rank_crew").assertIsDisplayed()
        composeRule.onNodeWithText("Vermelhos", useUnmergedTree = true).assertIsDisplayed()
        composeRule.onNodeWithText("#1 of 2", substring = true, useUnmergedTree = true).assertIsDisplayed()
        composeRule.onNodeWithText("10 pts", substring = true, useUnmergedTree = true).assertIsDisplayed()
        composeRule.onNodeWithText("+3 pts", useUnmergedTree = true).assertIsDisplayed()
    }

    @Test
    fun `fires the view season callback`() {
        var viewed = false
        composeRule.setContent {
            MaterialTheme {
                SeasonRankReveal(
                    rank = null,
                    standing = standing,
                    onWhyClick = {},
                    onViewSeason = { viewed = true },
                    onDismiss = {},
                    animate = false,
                )
            }
        }
        composeRule.onNodeWithText("View season").performClick()
        assertTrue(viewed)
    }

    @Test
    fun `renders nothing when there is neither a counted rank nor a standing`() {
        composeRule.setContent {
            MaterialTheme {
                SeasonRankReveal(
                    rank = rank.copy(counted = false),
                    standing = null,
                    onWhyClick = {},
                    onViewSeason = {},
                    onDismiss = {},
                    animate = false,
                )
            }
        }
        composeRule.onNodeWithTag("season_rank_reveal").assertDoesNotExist()
    }
}
