package dev.convocados.util

import org.junit.Assert.assertEquals
import org.junit.Test

class RankExplainerTest {

    @Test
    fun `builds explainer url pre-filled with the game numbers`() {
        val url = buildRankExplainerUrl(
            serverUrl = "https://app.convocados.dev/",
            eventId = "evt1",
            seasonId = "s1",
            rank = 1532.0,
            delta = 32.0,
            outcome = 1.0,
        )
        assertEquals(
            "https://app.convocados.dev/events/evt1/rank-explainer?seasonId=s1&rank=1532&delta=32&outcome=1",
            url,
        )
    }

    @Test
    fun `how-it-works link carries only the season id`() {
        val url = buildRankExplainerUrl("https://app.convocados.dev", "evt1", seasonId = "s1")
        assertEquals("https://app.convocados.dev/events/evt1/rank-explainer?seasonId=s1", url)
    }

    @Test
    fun `outcomeFromScore maps win draw and loss`() {
        assertEquals(1.0, outcomeFromScore(3, 1), 0.0)
        assertEquals(0.5, outcomeFromScore(2, 2), 0.0)
        assertEquals(0.0, outcomeFromScore(1, 3), 0.0)
        assertEquals(0.5, outcomeFromScore(null, 3), 0.0)
    }
}
