package dev.convocados.wear.tile

import dev.convocados.wear.data.local.QuickGameState

/** Lifecycle of the quick game as shown on the tile. */
enum class QuickGameTileStatus { NONE, UPCOMING, LIVE, PAUSED }

/**
 * Pure snapshot that drives the tile. Kept free of Android/ProtoLayout types so
 * the tile's content logic is unit-testable.
 */
data class QuickGameTileData(
    val status: QuickGameTileStatus,
    val scoreOne: Int,
    val scoreTwo: Int,
    val sport: String,
) {
    val hasGame: Boolean get() = status != QuickGameTileStatus.NONE
}

/** Derive the tile content from the persisted quick game and the current time. */
fun quickGameTileData(state: QuickGameState, nowMs: Long): QuickGameTileData {
    val status = when {
        !state.isStarted -> QuickGameTileStatus.NONE
        state.isLive(nowMs) -> QuickGameTileStatus.LIVE
        nowMs < state.kickoffEpochMs!! -> QuickGameTileStatus.UPCOMING
        else -> QuickGameTileStatus.PAUSED
    }
    return QuickGameTileData(status, state.scoreOne, state.scoreTwo, state.sport)
}
