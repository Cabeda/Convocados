package dev.convocados.wear.util

import java.time.Instant
import java.time.temporal.ChronoUnit

/** Phase of a game relative to "now", for gating the Wear score screen. */
enum class GameScorePhase { NOT_STARTED, SCORABLE, ENDED }

/**
 * Classifies a game so the score screen can explain *why* it is (or isn't)
 * ready to be scored, instead of silently no-op'ing.
 *
 * A game is scorable from 60 minutes before its start time through the end of
 * its sport window. Before that it is [NOT_STARTED]; after the window elapses
 * it is [ENDED].
 */
fun gameScorePhase(
    dateTime: String?,
    sport: String,
    now: Instant = Instant.now(),
    kickoffEpochMs: Long? = null,
): GameScorePhase {
    val start = kickoffEpochMs?.let(Instant::ofEpochMilli)
        ?: dateTime?.let { parseInstant(it) }
        ?: return GameScorePhase.ENDED
    val minutesUntil = ChronoUnit.MINUTES.between(now, start)
    val windowMinutes = sportDurationMinutes(sport)
    return when {
        minutesUntil > 60 -> GameScorePhase.NOT_STARTED
        minutesUntil > -windowMinutes -> GameScorePhase.SCORABLE
        else -> GameScorePhase.ENDED
    }
}
