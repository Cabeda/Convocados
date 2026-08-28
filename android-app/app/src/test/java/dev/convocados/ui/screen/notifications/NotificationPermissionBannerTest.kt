package dev.convocados.ui.screen.notifications

import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import dev.convocados.ui.theme.ConvocadosTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "w411dp-h891dp")
class NotificationPermissionBannerTest {

    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun `enable action invokes the explicit permission callback`() {
        var requestCount = 0

        composeRule.setContent {
            ConvocadosTheme {
                NotificationPermissionBanner(onEnable = { requestCount++ })
            }
        }

        composeRule.onNodeWithText("Enable push").performClick()

        assertEquals(1, requestCount)
    }
}
