package dev.convocados.wear.tile

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.view.View
import android.widget.FrameLayout
import androidx.core.content.ContextCompat
import androidx.test.core.app.ApplicationProvider
import androidx.wear.tiles.ResourceBuilders
import androidx.wear.tiles.renderer.TileRenderer
import dev.convocados.wear.data.local.QUICK_SPORT_TENNIS
import java.io.File
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.GraphicsMode

/**
 * Renders the Quick game tile for the Wear store listing.
 *
 * Play recommends a screenshot of Tiles functionality when the app offers Tiles,
 * and the Wear listing has no tile capture. The tile is a ProtoLayout surface the
 * system renders, so this test inflates the **live layout** — the very
 * [quickGameTileLayout] the service serves, not a second copy that could drift —
 * with `androidx.wear.tiles:tiles-renderer`, the preview renderer the launcher
 * uses.
 *
 * The PNG is drawn straight to a bitmap rather than through Roborazzi: Roborazzi
 * captures a View only as its Activity's window (a 320x470 frame, system chrome
 * included), and a store screenshot must be exactly the 390x390 tile. The pixels
 * are still gated — `pnpm check:play-screenshots` reads this file like the rest
 * (opaque, 1:1, >=384, black corners).
 *
 * WO-G5 applies as it does to the other captures: opaque, 1:1, only the tile. The
 * frame is painted black because a tile has no background of its own (the system
 * composites it over the watch face), and a transparent background is what Play
 * forbids.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class QuickGameTileScreenshotTest {

    @Test
    fun liveQuickGameTile() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val data = QuickGameTileData(QuickGameTileStatus.LIVE, 3, 2, QUICK_SPORT_TENNIS)
        val layout = quickGameTileLayout(
            data = data,
            resources = context.resources,
            packageName = "com.cabeda.Convocados",
            activityClassName = "dev.convocados.wear.ui.WearActivity",
        )
        @Suppress("DEPRECATION")
        val tilesLayout = androidx.wear.tiles.LayoutElementBuilders.Layout.fromProto(layout.toProto())
        val resources = ResourceBuilders.Resources.Builder().setVersion("1").build()
        @Suppress("DEPRECATION")
        val renderer = TileRenderer(
            context,
            tilesLayout,
            resources,
            ContextCompat.getMainExecutor(context),
        ) { }

        // TileRenderer.inflate adds the tile to the parent it is given, so the
        // black backing frame is that parent.
        val frame = FrameLayout(context).apply { setBackgroundColor(Color.BLACK) }
        @Suppress("DEPRECATION")
        renderer.inflate(frame) ?: error("TileRenderer.inflate returned null")

        val size = 390
        frame.measure(
            View.MeasureSpec.makeMeasureSpec(size, View.MeasureSpec.EXACTLY),
            View.MeasureSpec.makeMeasureSpec(size, View.MeasureSpec.EXACTLY),
        )
        frame.layout(0, 0, size, size)
        val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        canvas.drawColor(Color.BLACK)
        frame.draw(canvas)
        val out = File("src/test/screenshots/store-listing/quick_game_tile.png")
        out.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
    }
}
