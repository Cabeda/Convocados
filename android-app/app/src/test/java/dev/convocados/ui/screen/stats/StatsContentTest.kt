package dev.convocados.ui.screen.stats

import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import dev.convocados.data.api.EventStats
import dev.convocados.data.api.PlayerStats
import dev.convocados.data.api.StatsSummary
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
class StatsContentTest {

    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun `fixture stats render summary and navigate to an event`() {
        val stats = PlayerStats(
            summary = StatsSummary(totalGames = 18, totalWins = 11, totalDraws = 2, totalLosses = 5, winRate = 0.61, avgRating = 1240),
            events = listOf(EventStats(eventId = "event-1", eventTitle = "Tuesday Football", gamesPlayed = 8, rating = 1260, wins = 5, draws = 1, losses = 2)),
        )
        var clickedEvent: String? = null

        composeRule.setContent {
            ConvocadosTheme {
                StatsContent(
                    stats = stats,
                    loading = false,
                    error = null,
                    onRefresh = {},
                    onEventClick = { clickedEvent = it },
                )
            }
        }

        composeRule.onNodeWithText("Tuesday Football").performClick()

        assertEquals("event-1", clickedEvent)
    }
}
