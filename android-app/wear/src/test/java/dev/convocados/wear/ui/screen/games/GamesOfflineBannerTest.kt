package dev.convocados.wear.ui.screen.games

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class GamesOfflineBannerTest {
    @Test
    fun `connected watch hides cached banner after failed refresh`() {
        assertFalse(shouldShowOfflineGamesBanner(isOffline = true, isOnline = true))
    }

    @Test
    fun `offline watch keeps cached banner after failed refresh`() {
        assertTrue(shouldShowOfflineGamesBanner(isOffline = true, isOnline = false))
        assertFalse(shouldShowOfflineGamesBanner(isOffline = false, isOnline = false))
    }
}
