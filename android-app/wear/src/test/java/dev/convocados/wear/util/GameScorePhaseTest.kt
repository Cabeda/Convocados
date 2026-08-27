package dev.convocados.wear.util

import org.junit.Assert.*
import org.junit.Test
import java.time.Instant
import java.time.temporal.ChronoUnit

class GameScorePhaseTest {

    private val now: Instant = Instant.parse("2026-08-27T10:00:00Z")

    private fun mins(m: Long): Instant = now.plus(m, ChronoUnit.MINUTES)
    private fun iso(t: Instant): String = t.toString()

    @Test
    fun `far-future game is NOT_STARTED`() {
        // 2h away — more than the 1h pre-start window
        assertEquals(GameScorePhase.NOT_STARTED, gameScorePhase(iso(mins(120)), "futsal", now))
    }

    @Test
    fun `game within 1h before start is SCORABLE`() {
        assertEquals(GameScorePhase.SCORABLE, gameScorePhase(iso(mins(30)), "futsal", now))
    }

    @Test
    fun `game right now is SCORABLE`() {
        assertEquals(GameScorePhase.SCORABLE, gameScorePhase(iso(mins(0)), "futsal", now))
    }

    @Test
    fun `game in progress but inside duration is SCORABLE`() {
        // futsal = 60min window; 30min in -> inside -> scorable
        assertEquals(GameScorePhase.SCORABLE, gameScorePhase(iso(mins(-30)), "futsal", now))
    }

    @Test
    fun `game still scorable at the very end of its window`() {
        // 59min elapsed of a 60min game -> not yet ended (minutesUntil -59 > -60)
        assertEquals(GameScorePhase.SCORABLE, gameScorePhase(iso(mins(-59)), "futsal", now))
    }

    @Test
    fun `game after its window is ENDED`() {
        // 61min elapsed of a 60min game -> ended
        assertEquals(GameScorePhase.ENDED, gameScorePhase(iso(mins(-61)), "futsal", now))
    }

    @Test
    fun `longer sport window keeps game scorable for basketball`() {
        // basketball = 48min; 47min in -> inside
        assertEquals(GameScorePhase.SCORABLE, gameScorePhase(iso(mins(-47)), "basketball", now))
    }

    @Test
    fun `missing or unparseable dateTime is ENDED`() {
        assertEquals(GameScorePhase.ENDED, gameScorePhase(null, "futsal", now))
        assertEquals(GameScorePhase.ENDED, gameScorePhase("not-a-date", "futsal", now))
    }
}
