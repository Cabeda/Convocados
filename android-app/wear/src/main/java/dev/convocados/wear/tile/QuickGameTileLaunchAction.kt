package dev.convocados.wear.tile

import androidx.wear.protolayout.ActionBuilders
import androidx.wear.protolayout.DimensionBuilders
import androidx.wear.protolayout.ModifiersBuilders
import dev.convocados.wear.ui.ongoing.WearOngoingActivity

/** The id of the whole-tile clickable the service installs. */
internal const val TILE_CLICKABLE_ID = "quick_game"

/** The tile's whole-surface modifiers: padding, then the tap payload. */
fun quickGameTileModifiers(
    data: QuickGameTileData,
    packageName: String,
    activityClassName: String,
): ModifiersBuilders.Modifiers =
    ModifiersBuilders.Modifiers.Builder()
        .setPadding(ModifiersBuilders.Padding.Builder().setAll(DimensionBuilders.dp(12f)).build())
        .setClickable(
            ModifiersBuilders.Clickable.Builder()
                .setId(TILE_CLICKABLE_ID)
                .setOnClick(
                    tileLaunchAction(
                        status = data.status,
                        packageName = packageName,
                        activityClassName = activityClassName,
                    ),
                )
                .build(),
        )
        .build()

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
