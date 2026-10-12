package dev.convocados.wear.tile

import dev.convocados.wear.data.local.QuickGameState

/** Lifecycle of the quick game as shown on the tile. */
enum class QuickGameTileStatus { NONE, UPCOMING, LIVE, PAUSED }

/**
 * Pure snapshot that drives the tile. Kept free of Android/ProtoLayout types so
 * the tile's content logic is unit-testable.
 *
 * [hasGame] is what the tile *presents*, and it is gated on
 * [QuickGameTileStatus.LIVE] only — the same window the ongoing activity lives
 * in. A finished game has no destination: the tap gate is LIVE-only, the games
 * list hides the only "continue" CTA once the game is over, so publishing its
 * score is a dead end (GH #993 / dex pytzuddq). The tile falls back to the
 * one-tap CTA instead, which lands where the user can start the next game.
 */
data class QuickGameTileData(
    val status: QuickGameTileStatus,
    val scoreOne: Int,
    val scoreTwo: Int,
    val sport: String,
) {
    val hasGame: Boolean get() = status == QuickGameTileStatus.LIVE
}

/**
 * Whether the tile's tap should deep-link straight into the quick game.
 *
 * Play's tile guidance expects a tile showing an in-progress activity to open
 * that activity, so only [QuickGameTileStatus.LIVE] earns the deep link; an
 * upcoming, paused or absent game keeps the tap a plain launcher open.
 */
fun shouldLaunchQuickGame(status: QuickGameTileStatus): Boolean =
    status == QuickGameTileStatus.LIVE

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
