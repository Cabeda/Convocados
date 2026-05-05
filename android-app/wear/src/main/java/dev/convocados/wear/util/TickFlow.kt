package dev.convocados.wear.util

import java.time.Instant
import java.time.temporal.ChronoUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOn

/**
 * Emits the current time every [intervalMs] milliseconds.
 * Used to drive time-dependent UI recomputation (e.g. canScoreGame)
 * without requiring a server round-trip.
 */
fun tickFlow(intervalMs: Long = 60_000L): Flow<Instant> = flow {
    while (true) {
        emit(Instant.now())
        delay(intervalMs)
    }
}.flowOn(Dispatchers.Default)

/**
 * Compute adaptive interval for a list of upcoming game times.
 * - >2 hours away: 5 minutes (saves battery)
 * - Within 2 hours: 30 seconds (responsive)
 * - Within 10 minutes: 10 seconds (very responsive)
 * - Game in progress or past: 60 seconds (stable)
 */
fun computeAdaptiveInterval(now: Instant, gameTimes: List<Instant>): Long {
    if (gameTimes.isEmpty()) return 300_000L // 5 min default

    val minutesUntilNearest = gameTimes.minOf { ChronoUnit.MINUTES.between(now, it) }

    return when {
        minutesUntilNearest > 120 -> 300_000L   // >2h: 5 min
        minutesUntilNearest in 10..120 -> 30_000L // 10m-2h: 30s
        minutesUntilNearest in 0..9 -> 10_000L   // 0-10m: 10s
        else -> 60_000L // past/game in progress: 1 min
    }
}