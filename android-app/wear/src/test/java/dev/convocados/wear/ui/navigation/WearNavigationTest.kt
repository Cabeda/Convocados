package dev.convocados.wear.ui.navigation

import androidx.navigation.NavController
import androidx.navigation.NavOptions
import dev.convocados.wear.ui.ongoing.OngoingLaunch
import io.mockk.*
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class WearNavigationTest {

    @Test
    fun `authenticated live-game launch deep-links into the score screen`() {
        assertEquals(
            WearRoutes.score("evt-42"),
            startDestinationFor(isAuthenticated = true, launch = OngoingLaunch(eventId = "evt-42")),
        )
    }

    @Test
    fun `authenticated quick-game launch deep-links into the quick score screen`() {
        assertEquals(
            WearRoutes.QUICK_SCORE,
            startDestinationFor(isAuthenticated = true, launch = OngoingLaunch(quickGame = true)),
        )
    }

    @Test
    fun `launch without auth falls back to the auth screen`() {
        assertEquals(
            WearRoutes.AUTH,
            startDestinationFor(isAuthenticated = false, launch = OngoingLaunch(eventId = "evt-42")),
        )
    }

    @Test
    fun `plain launch opens the games list when authenticated`() {
        assertEquals(
            WearRoutes.GAMES,
            startDestinationFor(isAuthenticated = true, launch = null),
        )
    }

    @Test
    fun `successful save pops back to existing Games destination`() {
        val navController = mockk<NavController>(relaxed = true)
        every { navController.popBackStack(WearRoutes.GAMES, false) } returns true

        finishQuickGame(navController)

        verify(exactly = 1) { navController.popBackStack(WearRoutes.GAMES, false) }
    }

    @Test
    fun `successful save creates Games destination when quick game started from Auth`() {
        val navController = mockk<NavController>(relaxed = true)
        every { navController.popBackStack(WearRoutes.GAMES, false) } returns false

        finishQuickGame(navController)

        val options = slot<NavOptions>()
        verify(exactly = 1) {
            navController.navigate(eq(WearRoutes.GAMES), capture(options))
        }
        assertEquals(WearRoutes.AUTH, options.captured.popUpToRoute)
        assertTrue(options.captured.isPopUpToInclusive())
    }
}
