package dev.convocados.wear.ui

import android.view.View
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.junit4.createComposeRule
import dev.convocados.wear.ui.theme.ConvocadosWearTheme
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "w200dp-h200dp")
class KeepScreenOnTest {

    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun `setting is applied and restored when the composition leaves`() {
        val showKeepScreenOn = mutableStateOf(true)
        var composedView: View? = null

        composeRule.setContent {
            ConvocadosWearTheme {
                composedView = androidx.compose.ui.platform.LocalView.current
                if (showKeepScreenOn.value) {
                    RememberKeepScreenOn(enabled = true)
                }
            }
        }
        composeRule.runOnIdle {
            assertTrue(composedView!!.keepScreenOn)
            showKeepScreenOn.value = false
        }
        composeRule.waitForIdle()
        assertFalse(composedView!!.keepScreenOn)
    }

    @Test
    fun `changing the preference updates the view flag`() {
        val enabled = mutableStateOf(true)
        var composedView: View? = null

        composeRule.setContent {
            ConvocadosWearTheme {
                composedView = androidx.compose.ui.platform.LocalView.current
                RememberKeepScreenOn(enabled.value)
            }
        }
        composeRule.runOnIdle {
            assertTrue(composedView!!.keepScreenOn)
            enabled.value = false
        }
        composeRule.waitForIdle()
        assertFalse(composedView!!.keepScreenOn)
    }
}
