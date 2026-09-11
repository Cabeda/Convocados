package dev.convocados.wear.tile

import dev.convocados.wear.data.local.QUICK_SPORT_PADEL
import dev.convocados.wear.data.local.QuickGameState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class QuickGameTileTest {

    private val kickoff = 1_000_000_000_000L
    private val hour = 60 * 60_000L

    private fun state(kickoffMs: Long? = null, duration: Int = 60) = QuickGameState(
        scoreOne = 3,
        scoreTwo = 2,
        sport = QUICK_SPORT_PADEL,
        durationMinutes = duration,
        kickoffEpochMs = kickoffMs,
    )

    @Test
    fun noKickoff_isIdle() {
        val data = quickGameTileData(state(), kickoff)
        assertEquals(QuickGameTileStatus.NONE, data.status)
        assertFalse(data.hasGame)
    }

    @Test
    fun insideWindow_isLive() {
        val started = state(kickoff)
        assertEquals(QuickGameTileStatus.LIVE, quickGameTileData(started, kickoff).status)
        assertEquals(QuickGameTileStatus.LIVE, quickGameTileData(started, kickoff + 30 * 60_000L).status)
        assertEquals(QuickGameTileStatus.LIVE, quickGameTileData(started, kickoff + hour).status)
    }

    @Test
    fun beforeKickoff_isUpcoming() {
        val started = state(kickoff)
        assertEquals(QuickGameTileStatus.UPCOMING, quickGameTileData(started, kickoff - 1).status)
        assertTrue(quickGameTileData(started, kickoff - 1).hasGame)
    }

    @Test
    fun afterWindow_isPaused() {
        val started = state(kickoff)
        assertEquals(QuickGameTileStatus.PAUSED, quickGameTileData(started, kickoff + hour + 1).status)
    }

    @Test
    fun carriesScoreAndSport() {
        val data = quickGameTileData(state(kickoff), kickoff)
        assertEquals(3, data.scoreOne)
        assertEquals(2, data.scoreTwo)
        assertEquals(QUICK_SPORT_PADEL, data.sport)
    }
}
