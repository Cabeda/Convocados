package dev.convocados.wear.data.local

import dev.convocados.wear.data.api.SetScore
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class QuickGameStateTest {

    private val kickoff = 1_000_000_000_000L
    private fun min(m: Int) = m * 60_000L

    @Test
    fun `legacy json defaults to standard sport and empty sets`() {
        val legacy = """{"scoreOne":2,"scoreTwo":1,"durationMinutes":60,"alarmIntervalMinutes":10,"kickoffEpochMs":1000}"""
        val game = Json { ignoreUnknownKeys = true }.decodeFromString<QuickGameState>(legacy)

        assertEquals("standard", game.sport)
        assertTrue(game.scoreSets.isEmpty())
        assertEquals(2, game.scoreOne)
    }

    @Test
    fun `sport and structured score are part of persisted state`() {
        val game = QuickGameState(
            sport = "padel",
            scoreSets = listOf(SetScore(6, 4)),
        )

        assertEquals("padel", game.sport)
        assertEquals(6, game.scoreSets.single().teamOne)
    }

    @Test
    fun `not started until a kickoff is set`() {
        assertFalse(QuickGameState().isStarted)
        assertFalse(QuickGameState().isLive(kickoff))
    }

    @Test
    fun `live while inside the duration window`() {
        val game = QuickGameState(durationMinutes = 60, kickoffEpochMs = kickoff)
        assertTrue(game.isLive(kickoff))
        assertTrue(game.isLive(kickoff + min(30)))
        assertFalse(game.isLive(kickoff - 1))
        assertFalse(game.isLive(kickoff + min(61)))
    }

    @Test
    fun `exactly at the end is still live`() {
        val game = QuickGameState(durationMinutes = 30, kickoffEpochMs = kickoff)
        assertTrue(game.isLive(kickoff + min(30)))
    }
}
