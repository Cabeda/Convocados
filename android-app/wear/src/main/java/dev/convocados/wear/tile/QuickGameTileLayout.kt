package dev.convocados.wear.tile

import android.content.res.Resources
import androidx.wear.protolayout.ColorBuilders
import androidx.wear.protolayout.DimensionBuilders
import androidx.wear.protolayout.LayoutElementBuilders
import androidx.wear.protolayout.ModifiersBuilders
import androidx.wear.protolayout.TypeBuilders
import dev.convocados.wear.R
import dev.convocados.wear.data.local.QUICK_SPORT_PADEL
import dev.convocados.wear.data.local.QUICK_SPORT_TENNIS

private const val COLOR_TEXT = 0xFFFFFFFF.toInt()
private const val COLOR_MUTED = 0xB3FFFFFF.toInt()
private const val COLOR_LIVE = 0xFF7EE2A8.toInt()
private const val COLOR_PRIMARY = 0xFF2F8F4E.toInt()
private const val COLOR_ON_PRIMARY = 0xFFFFFFFF.toInt()

/**
 * The tile's layout, built from [data] and the app's [Resources] alone.
 *
 * Extracted from [QuickGameTileService] so the very same layout the service
 * serves is the one a screenshot fixture renders — a store capture of the tile
 * has to be the live tile, not a second rendering that can drift from it. The
 * service keeps only the wiring ([androidx.wear.tiles.RequestBuilders], the tap
 * payload's package/activity) and reads strings through [resources].
 */
internal fun quickGameTileLayout(
    data: QuickGameTileData,
    resources: Resources,
    packageName: String,
    activityClassName: String,
): LayoutElementBuilders.Layout {
    val column = LayoutElementBuilders.Column.Builder()
        .setWidth(DimensionBuilders.expand())
        .setHorizontalAlignment(LayoutElementBuilders.HORIZONTAL_ALIGN_CENTER)
    if (data.hasGame) {
        column.addContent(text(resources.getString(R.string.tile_quick_game_title), 12f, false, COLOR_MUTED))
        column.addContent(text("${data.scoreOne} – ${data.scoreTwo}", 40f, true, COLOR_TEXT))
        column.addContent(
            text(
                statusLine(data, resources),
                14f,
                false,
                if (data.status == QuickGameTileStatus.LIVE) COLOR_LIVE else COLOR_MUTED,
            ),
        )
    } else {
        column.addContent(text(resources.getString(R.string.tile_quick_game_title), 18f, true, COLOR_TEXT))
        column.addContent(text(resources.getString(R.string.tile_quick_game_idle), 12f, false, COLOR_MUTED))
        column.addContent(spacer(8f))
        column.addContent(pill(resources.getString(R.string.tile_quick_game_cta)))
    }
    return LayoutElementBuilders.Layout.Builder()
        .setRoot(
            LayoutElementBuilders.Box.Builder()
                .setWidth(DimensionBuilders.expand())
                .setHeight(DimensionBuilders.expand())
                .setHorizontalAlignment(LayoutElementBuilders.HORIZONTAL_ALIGN_CENTER)
                .setVerticalAlignment(LayoutElementBuilders.VERTICAL_ALIGN_CENTER)
                .setModifiers(
                    quickGameTileModifiers(
                        data = data,
                        packageName = packageName,
                        activityClassName = activityClassName,
                    ),
                )
                .addContent(column.build())
                .build(),
        )
        .build()
}

internal fun statusLine(data: QuickGameTileData, resources: Resources): String {
    val status = when (data.status) {
        QuickGameTileStatus.LIVE -> resources.getString(R.string.tile_quick_game_live)
        QuickGameTileStatus.UPCOMING -> resources.getString(R.string.tile_quick_game_upcoming)
        QuickGameTileStatus.PAUSED -> resources.getString(R.string.tile_quick_game_paused)
        QuickGameTileStatus.NONE -> ""
    }
    val sport = when (data.sport) {
        QUICK_SPORT_TENNIS -> resources.getString(R.string.tile_sport_tennis)
        QUICK_SPORT_PADEL -> resources.getString(R.string.tile_sport_padel)
        else -> resources.getString(R.string.tile_sport_standard)
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
                .setWeight(
                    if (bold) {
                        LayoutElementBuilders.FONT_WEIGHT_BOLD
                    } else {
                        LayoutElementBuilders.FONT_WEIGHT_NORMAL
                    },
                )
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
