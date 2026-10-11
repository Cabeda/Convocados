package dev.convocados.wear.tile

import androidx.wear.protolayout.ActionBuilders
import androidx.wear.protolayout.ModifiersBuilders
import dev.convocados.wear.data.local.QUICK_SPORT_PADEL
import dev.convocados.wear.data.local.QuickGameState
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
    private val kickoff = 1_000_000_000_000L
    private val hour = 60 * 60_000L

    private fun state(kickoffMs: Long? = null, duration: Int = 60) = QuickGameState(
        scoreOne = 3,
        scoreTwo = 2,
        sport = QUICK_SPORT_PADEL,
        durationMinutes = duration,
        kickoffEpochMs = kickoffMs,
    )

    /** The tile data the service derives from persisted state at request time. */
    private fun tileData(nowMs: Long) = quickGameTileData(state(kickoff), nowMs)

    /** The clickable the tile actually installs on its whole-tile box. */
    private fun clickable(nowMs: Long) = quickGameTileModifiers(
        data = tileData(nowMs),
        packageName = packageName,
        activityClassName = WearActivity::class.java.name,
    ).clickable!!

    private fun quickExtra(clickable: ModifiersBuilders.Clickable) =
        (clickable.onClick as ActionBuilders.LaunchAction).androidActivity!!
            .keyToExtraMapping[WearOngoingActivity.EXTRA_QUICK_GAME]

    @Test
    fun `tile modifiers use the clickable quick game id`() {
        assertEquals("quick_game", clickable(kickoff + 10 * 60_000L).id)
    }

    @Test
    fun `tile modifiers deep link the persisted game while it is live`() {
        val extra = quickExtra(clickable(kickoff + 10 * 60_000L))
        assertTrue("a live tile must carry the quick-game deep link", extra is ActionBuilders.AndroidBooleanExtra)
        assertTrue((extra as ActionBuilders.AndroidBooleanExtra).value)
    }

    @Test
    fun `tile modifiers stay a plain launcher open before the kickoff`() {
        assertNull(quickExtra(clickable(kickoff - 1)))
    }

    @Test
    fun `tile modifiers stay a plain launcher open after the duration`() {
        assertNull(quickExtra(clickable(kickoff + hour + 1)))
    }

    @Test
    fun `tile deep links only while the quick game is live`() {
        assertTrue(shouldLaunchQuickGame(QuickGameTileStatus.LIVE))
        assertFalse(shouldLaunchQuickGame(QuickGameTileStatus.NONE))
        assertFalse(shouldLaunchQuickGame(QuickGameTileStatus.UPCOMING))
        assertFalse(shouldLaunchQuickGame(QuickGameTileStatus.PAUSED))
    }

    @Test
    fun `tile launch action opens the launcher activity itself`() {
        val launch = tileLaunchAction(QuickGameTileStatus.LIVE, packageName, WearActivity::class.java.name)
        val activity = launch.androidActivity!!
        assertEquals(packageName, activity.packageName)
        assertEquals(WearActivity::class.java.name, activity.className)
    }

    @Test
    fun `live tile launch action carries the quick game deep link`() {
        val launch = tileLaunchAction(QuickGameTileStatus.LIVE, packageName, WearActivity::class.java.name)
        val activity = launch.androidActivity!!
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
            val launch = tileLaunchAction(status, packageName, WearActivity::class.java.name)
            val activity = launch.androidActivity!!
            assertNull(
                "$status must not deep-link into the quick game",
                activity.keyToExtraMapping[WearOngoingActivity.EXTRA_QUICK_GAME],
            )
        }
    }
}
