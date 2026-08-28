package dev.convocados.wear.ui.navigation

import androidx.navigation.NavController
import androidx.navigation.NavOptions
import io.mockk.*
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class WearNavigationTest {

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
