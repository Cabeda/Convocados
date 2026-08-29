package dev.convocados.ui.screen.event

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import dev.convocados.designsystem.ExpressiveMotion
import dev.convocados.ui.theme.ConvocadosTheme
import dev.convocados.ui.theme.LocalConvocadosMotion
import dev.convocados.ui.theme.ThemeMode
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [33])
class ReducedMotionIndicatorTest {
    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun `reduced motion renders a steady live indicator`() {
        composeRule.setContent {
            ConvocadosTheme(themeMode = ThemeMode.Light) {
                CompositionLocalProvider(LocalConvocadosMotion provides ExpressiveMotion.Reduced) {
                    PulsingDot(Color.Red)
                }
            }
        }

        composeRule.onNodeWithContentDescription("Live indicator (steady)").assertExists()
    }
}
