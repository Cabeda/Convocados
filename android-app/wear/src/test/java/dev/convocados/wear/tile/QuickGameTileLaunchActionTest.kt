package dev.convocados.wear.tile

import androidx.wear.protolayout.ActionBuilders
import dev.convocados.wear.ui.WearActivity
import dev.convocados.wear.ui.ongoing.WearOngoingActivity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * The tile-side reference Play's ongoing-activity clause expects: a tile that
 * shows an in-progress game must open that game, not the app's home screen.
 */
@RunWith(RobolectricTestRunner::class)
// :wear is minSdk 35, so Robolectric cannot load the APK below that.
@Config(sdk = [35])
class QuickGameTileLaunchActionTest {

    private val packageName = "com.cabeda.Convocados"

    @Test
    fun `tile deep links only while the quick game is live`() {
        assertTrue(shouldLaunchQuickGame(QuickGameTileStatus.LIVE))
        assertFalse(shouldLaunchQuickGame(QuickGameTileStatus.NONE))
        assertFalse(shouldLaunchQuickGame(QuickGameTileStatus.UPCOMING))
        assertFalse(shouldLaunchQuickGame(QuickGameTileStatus.PAUSED))
    }

    @Test
    fun `tile launch action opens the launcher activity itself`() {
        val activity = tileLaunchAction(QuickGameTileStatus.LIVE, packageName, WearActivity::class.java.name)
            .androidActivity
        assertEquals(packageName, activity.packageName)
        assertEquals(WearActivity::class.java.name, activity.className)
    }

    @Test
    fun `live tile launch action carries the quick game deep link`() {
        val activity = tileLaunchAction(QuickGameTileStatus.LIVE, packageName, WearActivity::class.java.name)
            .androidActivity
        val extra = activity.keyToExtraMapping[WearOngoingActivity.EXTRA_QUICK_GAME]
        assertTrue("live tile must carry the quick-game deep link", extra is ActionBuilders.AndroidBooleanExtra)
        assertTrue((extra as ActionBuilders.AndroidBooleanExtra).value)
    }

    @Test
    fun `non live tile launch stays a plain launcher open`() {
        listOf(
            QuickGameTileStatus.NONE,
            QuickGameTileStatus.UPCOMING,
            QuickGameTileStatus.PAUSED,
        ).forEach { status ->
            val activity = tileLaunchAction(status, packageName, WearActivity::class.java.name).androidActivity
            assertNull(
                "$status must not deep-link into the quick game",
                activity.keyToExtraMapping[WearOngoingActivity.EXTRA_QUICK_GAME],
            )
        }
    }
}
