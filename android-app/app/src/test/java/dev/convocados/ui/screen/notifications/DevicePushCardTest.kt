package dev.convocados.ui.screen.notifications

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import dev.convocados.data.push.DevicePushState
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
class DevicePushCardTest {

    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun `on state shows the on label and opens system settings`() {
        var opened = 0
        composeRule.setContent {
            ConvocadosTheme {
                DevicePushCard(
                    state = DevicePushState.ON,
                    onEnable = { throw AssertionError("on state must not request permission") },
                    onOpenSettings = { opened++ },
                )
            }
        }

        composeRule.onNodeWithText("This device").assertIsDisplayed()
        composeRule.onNodeWithText("Notifications are on for this device").assertIsDisplayed()
        composeRule.onNodeWithText("Open settings").performClick()
        assertEquals(1, opened)
    }

    @Test
    fun `off state shows the off label and invokes the permission request`() {
        var enableCount = 0
        composeRule.setContent {
            ConvocadosTheme {
                DevicePushCard(
                    state = DevicePushState.OFF,
                    onEnable = { enableCount++ },
                    onOpenSettings = { throw AssertionError("off state must open the system dialog") },
                )
            }
        }

        composeRule.onNodeWithText("Notifications are off on this device").assertIsDisplayed()
        composeRule.onNodeWithText("Enable push").performClick()
        assertEquals(1, enableCount)
    }

    @Test
    fun `blocked state shows the blocked label and opens system settings`() {
        var opened = 0
        composeRule.setContent {
            ConvocadosTheme {
                DevicePushCard(
                    state = DevicePushState.BLOCKED,
                    onEnable = { throw AssertionError("blocked state must not request permission") },
                    onOpenSettings = { opened++ },
                )
            }
        }

        composeRule.onNodeWithText("Notifications are blocked in system settings").assertIsDisplayed()
        composeRule.onNodeWithText("Open settings").performClick()
        assertEquals(1, opened)
    }
}
