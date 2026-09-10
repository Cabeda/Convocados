package dev.convocados.wear.ui.ongoing

import android.Manifest
import android.app.NotificationManager
import android.content.Context
import dev.convocados.wear.util.GameScorePhase
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
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
}
