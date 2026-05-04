package dev.convocados.wear.util

import java.time.Instant
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
        emit(java.time.Instant.now())
        delay(intervalMs)
    }
}.flowOn(Dispatchers.Default)