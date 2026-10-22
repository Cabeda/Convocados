package dev.convocados.wear.util

import java.time.Instant
import java.time.temporal.ChronoUnit

/** Phase of a game relative to "now", for gating the Wear score screen. */
enum class GameScorePhase { NOT_STARTED, SCORABLE }

/**
 * Classifies a game so the score screen can explain *why* it is (or isn't)
 * ready to be scored.
 *
 * A game is scorable from 60 minutes before its start time and stays
 * scorable for as long as it lasts: the clock never ends a game (#1360). A
 * match that runs past its window can still be scored, because the organizer
 * closes it explicitly with the Finish action instead of the watch deciding
 * on its own that the game is over.
 */
fun gameScorePhase(
    dateTime: String?,
    now: Instant = Instant.now(),
    kickoffEpochMs: Long? = null,
): GameScorePhase {
    val start = kickoffEpochMs?.let(Instant::ofEpochMilli)
        ?: dateTime?.let { parseInstant(it) }
        ?: return GameScorePhase.SCORABLE
    val minutesUntil = ChronoUnit.MINUTES.between(now, start)
    return if (minutesUntil > 60) GameScorePhase.NOT_STARTED else GameScorePhase.SCORABLE
}
