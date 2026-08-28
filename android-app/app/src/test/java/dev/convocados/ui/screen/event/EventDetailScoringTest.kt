package dev.convocados.ui.screen.event

import dev.convocados.data.api.GameHistory
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class EventDetailScoringTest {
    @Test
    fun `legacy scalar tennis history keeps scalar editor`() {
        val history = GameHistory(
            id = "h1",
            dateTime = "2026-08-27T10:00:00Z",
            scoreOne = 2,
            scoreTwo = 1,
            scoringType = "tennis",
        )

        assertFalse(usesStructuredTennisScore("tennis", history))
    }

    @Test
    fun `blank tennis history opens structured editor`() {
        val history = GameHistory(
            id = "h1",
            dateTime = "2026-08-27T10:00:00Z",
            scoringType = "tennis",
        )

        assertTrue(usesStructuredTennisScore("tennis", history))
    }

    @Test
    fun `structured tennis history stays in structured editor`() {
        val history = GameHistory(
            id = "h1",
            dateTime = "2026-08-27T10:00:00Z",
            scoreOne = 1,
            scoreTwo = 0,
            scoreSets = emptyList(),
            scoringType = "tennis",
        )

        assertTrue(usesStructuredTennisScore("tennis", history))
    }

    @Test
    fun `standard history uses scalar editor`() {
        val history = GameHistory(
            id = "h1",
            dateTime = "2026-08-27T10:00:00Z",
            scoreOne = 2,
            scoreTwo = 1,
        )

        assertFalse(usesStructuredTennisScore("soccer", history))
    }
}
