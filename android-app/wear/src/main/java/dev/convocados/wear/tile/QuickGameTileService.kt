package dev.convocados.wear.tile

import androidx.wear.protolayout.ActionBuilders
import androidx.wear.protolayout.ColorBuilders
import androidx.wear.protolayout.DimensionBuilders
import androidx.wear.protolayout.LayoutElementBuilders
import androidx.wear.protolayout.ModifiersBuilders
import androidx.wear.protolayout.TimelineBuilders
import androidx.concurrent.futures.CallbackToFutureAdapter
import androidx.wear.protolayout.TypeBuilders
import androidx.wear.tiles.RequestBuilders
import androidx.wear.tiles.TileBuilders
import androidx.wear.tiles.TileService
import com.google.common.util.concurrent.ListenableFuture
import dagger.hilt.android.AndroidEntryPoint
import dev.convocados.wear.R
import dev.convocados.wear.data.local.QuickGameStore
import dev.convocados.wear.data.local.QUICK_SPORT_PADEL
import dev.convocados.wear.data.local.QUICK_SPORT_TENNIS
import dev.convocados.wear.ui.WearActivity
import javax.inject.Inject

private const val COLOR_TEXT = 0xFFFFFFFF.toInt()
private const val COLOR_MUTED = 0xB3FFFFFF.toInt()
private const val COLOR_LIVE = 0xFF7EE2A8.toInt()
private const val COLOR_PRIMARY = 0xFF2F8F4E.toInt()
private const val COLOR_ON_PRIMARY = 0xFFFFFFFF.toInt()

private const val FRESHNESS_MS = 30_000L

/**
 * Home-screen tile: the live quick-game score when one is running, otherwise a
 * one-tap quick-game CTA. Tapping anywhere opens [WearActivity] (a LaunchAction
 * to the launcher activity — no renderable-action artifact needed).
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
                    .setLayout(LayoutElementBuilders.Layout.Builder().setRoot(buildLayout(data)).build())
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

    private fun buildLayout(data: QuickGameTileData): LayoutElementBuilders.LayoutElement {
        val column = LayoutElementBuilders.Column.Builder()
            .setWidth(DimensionBuilders.expand())
            .setHorizontalAlignment(LayoutElementBuilders.HORIZONTAL_ALIGN_CENTER)
        if (data.hasGame) {
            column.addContent(text(getString(R.string.tile_quick_game_title), 12f, false, COLOR_MUTED))
            column.addContent(text("${data.scoreOne} – ${data.scoreTwo}", 40f, true, COLOR_TEXT))
            column.addContent(
                text(
                    statusLine(data),
                    14f,
                    false,
                    if (data.status == QuickGameTileStatus.LIVE) COLOR_LIVE else COLOR_MUTED,
                ),
            )
        } else {
            column.addContent(text(getString(R.string.tile_quick_game_title), 18f, true, COLOR_TEXT))
            column.addContent(text(getString(R.string.tile_quick_game_idle), 12f, false, COLOR_MUTED))
            column.addContent(spacer(8f))
            column.addContent(pill(getString(R.string.tile_quick_game_cta)))
        }
        return LayoutElementBuilders.Box.Builder()
            .setWidth(DimensionBuilders.expand())
            .setHeight(DimensionBuilders.expand())
            .setHorizontalAlignment(LayoutElementBuilders.HORIZONTAL_ALIGN_CENTER)
            .setVerticalAlignment(LayoutElementBuilders.VERTICAL_ALIGN_CENTER)
            .setModifiers(
                ModifiersBuilders.Modifiers.Builder()
                    .setPadding(
                        ModifiersBuilders.Padding.Builder()
                            .setAll(DimensionBuilders.dp(12f))
                            .build(),
                    )
                    .setClickable(
                        ModifiersBuilders.Clickable.Builder()
                            .setId("quick_game")
                            .setOnClick(launchApp())
                            .build(),
                    )
                    .build(),
            )
            .addContent(column.build())
            .build()
    }

    private fun statusLine(data: QuickGameTileData): String {
        val status = when (data.status) {
            QuickGameTileStatus.LIVE -> getString(R.string.tile_quick_game_live)
            QuickGameTileStatus.UPCOMING -> getString(R.string.tile_quick_game_upcoming)
            QuickGameTileStatus.PAUSED -> getString(R.string.tile_quick_game_paused)
            QuickGameTileStatus.NONE -> ""
        }
        val sport = when (data.sport) {
            QUICK_SPORT_TENNIS -> getString(R.string.tile_sport_tennis)
            QUICK_SPORT_PADEL -> getString(R.string.tile_sport_padel)
            else -> getString(R.string.tile_sport_standard)
        }
        return "$status · $sport"
    }

    private fun text(
        value: String,
        sizeSp: Float,
        bold: Boolean,
        color: Int,
    ): LayoutElementBuilders.Text =
        LayoutElementBuilders.Text.Builder()
            .setText(TypeBuilders.StringProp.Builder(value).build())
            .setMaxLines(2)
            .setFontStyle(
                LayoutElementBuilders.FontStyle.Builder()
                    .setColor(ColorBuilders.ColorProp.Builder(color).build())
                    .setSize(DimensionBuilders.sp(sizeSp))
                    .setWeight(if (bold) 700 else 400)
                    .build(),
            )
            .build()

    private fun spacer(heightDp: Float): LayoutElementBuilders.Spacer =
        LayoutElementBuilders.Spacer.Builder()
            .setHeight(DimensionBuilders.dp(heightDp))
            .build()

    private fun pill(label: String): LayoutElementBuilders.Box =
        LayoutElementBuilders.Box.Builder()
            .setModifiers(
                ModifiersBuilders.Modifiers.Builder()
                    .setBackground(
                        ModifiersBuilders.Background.Builder()
                            .setColor(ColorBuilders.ColorProp.Builder(COLOR_PRIMARY).build())
                            .setCorner(
                                ModifiersBuilders.Corner.Builder()
                                    .setRadius(DimensionBuilders.dp(18f))
                                    .build(),
                            )
                            .build(),
                    )
                    .setPadding(
                        ModifiersBuilders.Padding.Builder()
                            .setStart(DimensionBuilders.dp(14f))
                            .setEnd(DimensionBuilders.dp(14f))
                            .setTop(DimensionBuilders.dp(6f))
                            .setBottom(DimensionBuilders.dp(6f))
                            .build(),
                    )
                    .build(),
            )
            .addContent(text(label, 14f, true, COLOR_ON_PRIMARY))
            .build()

    private fun launchApp(): ActionBuilders.LaunchAction =
        ActionBuilders.LaunchAction.Builder()
            .setAndroidActivity(
                ActionBuilders.AndroidActivity.Builder()
                    .setPackageName(packageName)
                    .setClassName(WearActivity::class.java.name)
                    .build(),
            )
            .build()
}
