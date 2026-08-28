package dev.convocados.ui.screen.event

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class OfflineStaleBannerTest {
    @Test
    fun `banner is shown only for cached data after a failed refresh while offline`() {
        assertTrue(shouldShowOfflineStaleBanner(refreshFailed = true, hasCachedEvent = true, isOnline = false))
        assertFalse(shouldShowOfflineStaleBanner(refreshFailed = true, hasCachedEvent = true, isOnline = true))
    }

    @Test
    fun `banner is hidden when refresh succeeds or no cached event exists`() {
        assertFalse(shouldShowOfflineStaleBanner(refreshFailed = false, hasCachedEvent = true, isOnline = false))
        assertFalse(shouldShowOfflineStaleBanner(refreshFailed = true, hasCachedEvent = false, isOnline = false))
    }
}
