package dev.convocados.wear.data.local

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class QuickGameStateTest {

    private val kickoff = 1_000_000_000_000L
    private fun min(m: Int) = m * 60_000L

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