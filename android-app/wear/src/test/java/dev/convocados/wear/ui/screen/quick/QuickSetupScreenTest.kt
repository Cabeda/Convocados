package dev.convocados.wear.ui.screen.quick

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performScrollTo
import dev.convocados.wear.ui.theme.ConvocadosWearTheme
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "w200dp-h200dp")
class QuickSetupScreenTest {

    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun `round picker keeps all sport labels visible`() {
        composeRule.setContent {
            ConvocadosWearTheme {
                QuickSetupScreen(onStart = { _, _, _ -> })
            }
        }

        composeRule.onNodeWithText("Standard").assertIsDisplayed()
        composeRule.onNodeWithText("Tennis").assertIsDisplayed()
        composeRule.onNodeWithText("Padel").performScrollTo().assertIsDisplayed()
    }
}
