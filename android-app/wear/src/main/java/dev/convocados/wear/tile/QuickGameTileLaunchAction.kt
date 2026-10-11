package dev.convocados.wear.tile

import androidx.wear.protolayout.ActionBuilders
import dev.convocados.wear.ui.ongoing.WearOngoingActivity

/**
 * The LaunchAction the tile fires on tap: a whole-tile launch into
 * [dev.convocados.wear.ui.WearActivity].
 *
 * While a quick game is live it carries the [WearOngoingActivity.EXTRA_QUICK_GAME]
 * extra, so the tap resumes the running session instead of landing on the games
 * list. That is the tile-side reference Play's ongoing-activity clause asks for
 * — the user's "reopened and it didn't open in the game" complaint — and the
 * same entry point the ongoing notification's touch intent uses. Everything
 * else (upcoming, paused, idle) stays a plain launcher open.
 *
 * Kept apart from the tile service so the click payload is unit-testable
 * without a live TileService.
 */
fun tileLaunchAction(
    status: QuickGameTileStatus,
    packageName: String,
    activityClassName: String,
): ActionBuilders.LaunchAction {
    val activity = ActionBuilders.AndroidActivity.Builder()
        .setPackageName(packageName)
        .setClassName(activityClassName)
    if (shouldLaunchQuickGame(status)) {
        activity.addKeyToExtraMapping(
            WearOngoingActivity.EXTRA_QUICK_GAME,
            ActionBuilders.booleanExtra(true),
        )
    }
    return ActionBuilders.LaunchAction.Builder()
        .setAndroidActivity(activity.build())
        .build()
}
