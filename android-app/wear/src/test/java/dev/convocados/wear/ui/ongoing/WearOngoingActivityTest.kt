package dev.convocados.wear.ui.ongoing

import android.Manifest
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import androidx.wear.ongoing.OngoingActivity
import dev.convocados.wear.ui.WearActivity
import dev.convocados.wear.util.GameScorePhase
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
// :wear is minSdk 35, so Robolectric cannot load the APK below that.
@Config(sdk = [35])
class WearOngoingActivityTest {

    @Test
    fun `score text names both teams around the score`() {
        assertEquals("Northside 3 – 2 Riverside", ongoingScoreText("Northside", 3, "Riverside", 2))
    }

    @Test
    fun `live game is ongoing only after start and before end`() {
        assertFalse(shouldShowLiveGameOngoing(isScoring = false, phase = GameScorePhase.SCORABLE))
        assertTrue(shouldShowLiveGameOngoing(isScoring = true, phase = GameScorePhase.SCORABLE))
        assertFalse(shouldShowLiveGameOngoing(isScoring = true, phase = GameScorePhase.ENDED))
    }

    @Test
    fun `quick game is ongoing within its window only`() {
        val kickoff = 1_000_000L
        assertFalse(shouldShowQuickGameOngoing(null, 60, kickoff))
        assertFalse(shouldShowQuickGameOngoing(kickoff, 60, kickoff - 1))
        assertTrue(shouldShowQuickGameOngoing(kickoff, 60, kickoff))
        assertTrue(shouldShowQuickGameOngoing(kickoff, 60, kickoff + 59 * 60_000L))
        assertFalse(shouldShowQuickGameOngoing(kickoff, 60, kickoff + 60 * 60_000L))
    }

    @Test
    fun `show creates the ongoing channel and stop is safe to repeat`() {
        val context = RuntimeEnvironment.getApplication()
        shadowOf(context).grantPermissions(Manifest.permission.POST_NOTIFICATIONS)
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        WearOngoingActivity.show(context, "Live score", "Northside 3 – 2 Riverside")
        val channel = manager.getNotificationChannel(WearOngoingActivity.CHANNEL_ID)
        assertNotNull("ongoing channel must exist so the activity can render", channel)

        WearOngoingActivity.stop(context)
        WearOngoingActivity.stop(context)
    }

    @Test
    fun `show actually posts the ongoing notification`() {
        val context = RuntimeEnvironment.getApplication()
        shadowOf(context).grantPermissions(Manifest.permission.POST_NOTIFICATIONS)
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        WearOngoingActivity.show(context, "Live score", "Northside 3 – 2 Riverside")

        val posted = manager.activeNotifications.any { it.id == WearOngoingActivity.NOTIFICATION_ID }
        assertTrue(
            "OngoingActivity.apply() only decorates the builder; without notify() the " +
                "watch face indicator and recents chip never appear",
            posted,
        )
        assertEquals(1, manager.activeNotifications.size)
    }

    @Test
    fun `stop cancels the posted ongoing notification`() {
        val context = RuntimeEnvironment.getApplication()
        shadowOf(context).grantPermissions(Manifest.permission.POST_NOTIFICATIONS)
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        WearOngoingActivity.show(context, "Live score", "Northside 3 – 2 Riverside")
        WearOngoingActivity.stop(context)

        assertTrue(manager.activeNotifications.isEmpty())
    }

    // ── Deep link: the chip must resume the live session, not the games list ──

    @Test
    fun `ongoing launch intent carries the live game event deep link`() {
        val context = RuntimeEnvironment.getApplication()
        val intent = ongoingLaunchIntent(context, OngoingLaunch(eventId = "evt-42"))

        assertEquals(WearActivity::class.java.name, intent.component?.className)
        assertEquals("evt-42", intent.getStringExtra(WearOngoingActivity.EXTRA_EVENT_ID))
        assertFalse(intent.getBooleanExtra(WearOngoingActivity.EXTRA_QUICK_GAME, false))
    }

    @Test
    fun `ongoing launch intent carries the quick game deep link`() {
        val context = RuntimeEnvironment.getApplication()
        val intent = ongoingLaunchIntent(context, OngoingLaunch(quickGame = true))

        assertTrue(intent.getBooleanExtra(WearOngoingActivity.EXTRA_QUICK_GAME, true))
        assertNull(intent.getStringExtra(WearOngoingActivity.EXTRA_EVENT_ID))
    }

    @Test
    fun `parseOngoingLaunch round-trips both deep links and ignores a plain launch`() {
        val context = RuntimeEnvironment.getApplication()

        assertEquals(
            OngoingLaunch(eventId = "evt-42"),
            parseOngoingLaunch(ongoingLaunchIntent(context, OngoingLaunch(eventId = "evt-42"))),
        )
        assertEquals(
            OngoingLaunch(quickGame = true),
            parseOngoingLaunch(ongoingLaunchIntent(context, OngoingLaunch(quickGame = true))),
        )
        assertNull(parseOngoingLaunch(Intent(context, WearActivity::class.java)))
        assertNull(parseOngoingLaunch(null))
    }

    // ── Status: the surface must show the score, not just an icon ──

    @Test
    fun `ongoing status carries the live score text`() {
        val context = RuntimeEnvironment.getApplication()
        val status = ongoingStatus("Northside 3 – 2 Riverside")

        assertEquals(
            "Northside 3 – 2 Riverside",
            status.getText(context, System.currentTimeMillis()).toString(),
        )
    }

    @Test
    fun `show attaches a readable ongoing activity with status and deep link`() {
        val context = RuntimeEnvironment.getApplication()
        shadowOf(context).grantPermissions(Manifest.permission.POST_NOTIFICATIONS)

        WearOngoingActivity.show(
            context,
            "Live score",
            "Northside 3 – 2 Riverside",
            OngoingLaunch(eventId = "evt-42"),
        )

        val recovered = OngoingActivity.recoverOngoingActivity(context)
        assertNotNull("the watch face / recents must be able to recover the ongoing activity", recovered)
        assertEquals(
            "Northside 3 – 2 Riverside",
            recovered!!.status?.getText(context, System.currentTimeMillis())?.toString(),
        )
    }

    // ── Lifecycle: leaving the screen mid-game must not clear the indicator ──

    @Test
    fun `ongoing activity is only cleared when the session is no longer live`() {
        assertFalse("a live game must survive the score screen leaving composition", shouldClearOngoing(true))
        assertTrue("an ended game clears the indicator", shouldClearOngoing(false))
    }
}
