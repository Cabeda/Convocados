package dev.convocados.ui.screen.login

import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onRoot
import com.github.takahirom.roborazzi.captureRoboImage
import dev.convocados.ui.theme.ConvocadosTheme
import dev.convocados.ui.theme.ThemeMode
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Deterministic login screenshots. The content seam keeps visual review
 * independent of Hilt, OAuth, browser state, and network availability.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "w411dp-h891dp")
class LoginScreenshotTest {

    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun login_light() = snapshot("login_light", ThemeMode.Light)

    @Test
    fun login_dark() = snapshot("login_dark", ThemeMode.Dark)

    private fun snapshot(name: String, themeMode: ThemeMode) {
        composeRule.setContent {
            ConvocadosTheme(themeMode = themeMode) {
                LoginContent(
                    uiState = LoginUiState(),
                    onGoogleSignIn = {},
                    onSignIn = { _, _ -> },
                    onSignUp = { _, _, _ -> },
                    onSendMagicLink = {},
                    onClearMessages = {},
                    getServerUrl = { "https://convocados.cabeda.dev" },
                    setServerUrl = {},
                )
            }
        }
        composeRule.onRoot().captureRoboImage("src/test/screenshots/$name.png")
    }
}
