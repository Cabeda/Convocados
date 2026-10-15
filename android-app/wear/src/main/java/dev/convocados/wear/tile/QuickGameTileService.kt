package dev.convocados.wear.tile

import androidx.wear.protolayout.TimelineBuilders
import androidx.concurrent.futures.CallbackToFutureAdapter
import androidx.wear.tiles.RequestBuilders
import androidx.wear.tiles.TileBuilders
import androidx.wear.tiles.TileService
import com.google.common.util.concurrent.ListenableFuture
import dagger.hilt.android.AndroidEntryPoint
import dev.convocados.wear.data.local.QuickGameStore
import dev.convocados.wear.ui.WearActivity
import javax.inject.Inject

private const val FRESHNESS_MS = 30_000L

/**
 * Home-screen tile: the live quick-game score when one is running, otherwise a
 * one-tap quick-game CTA. Tapping anywhere opens [WearActivity] (a LaunchAction
 * to the launcher activity — no renderable-action artifact needed).
 *
 * The tap payload is built by [quickGameTileModifiers]: while a quick game is
 * live it carries the deep link into the running session, which is what Play's
 * tile clause for an in-progress activity asks for.
 *
 * The layout itself lives in [quickGameTileLayout] so both this service and the
 * store-screenshot fixture render the one implementation.
 */
@AndroidEntryPoint
class QuickGameTileService : TileService() {

    @Inject
    lateinit var quickGameStore: QuickGameStore

    override fun onTileRequest(
        requestParams: RequestBuilders.TileRequest,
    ): ListenableFuture<TileBuilders.Tile> {
        val data = quickGameTileData(quickGameStore.state.value, System.currentTimeMillis())
        val timeline = TimelineBuilders.Timeline.Builder()
            .addTimelineEntry(
                TimelineBuilders.TimelineEntry.Builder()
                    .setLayout(
                        quickGameTileLayout(
                            data = data,
                            resources = resources,
                            packageName = packageName,
                            activityClassName = WearActivity::class.java.name,
                        ),
                    )
                    .build(),
            )
            .build()
        val tile = TileBuilders.Tile.Builder()
            .setResourcesVersion("1")
            .setFreshnessIntervalMillis(FRESHNESS_MS)
            .setTileTimeline(timeline)
            .build()
        return CallbackToFutureAdapter.getFuture { completer ->
            completer.set(tile)
            "quick_game_tile"
        }
    }
}
