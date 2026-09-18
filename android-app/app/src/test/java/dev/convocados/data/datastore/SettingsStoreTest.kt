package dev.convocados.data.datastore

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class SettingsStoreTest {

    @Test
    fun `dismissRankReveal persists the dismissal keyed by history id`() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val store = SettingsStore(context)

        assertTrue("no reveal should start dismissed", store.dismissedRankReveals.first().isEmpty())

        store.dismissRankReveal("history-1")

        val dismissed = store.dismissedRankReveals.first()
        assertTrue("history-1 should be dismissed", "history-1" in dismissed)
        assertFalse("history-2 must stay visible", "history-2" in dismissed)
    }
}
