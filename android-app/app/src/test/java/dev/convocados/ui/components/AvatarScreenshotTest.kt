package dev.convocados.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.unit.dp
import com.github.takahirom.roborazzi.captureRoboImage
import dev.convocados.ui.screen.event.PlayerAvatar
import dev.convocados.ui.theme.ConvocadosTheme
import dev.convocados.ui.theme.ThemeMode
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Screenshot guard for the initial-letter avatars. The letter must be centered on its
 * glyph ink box, not on the font's line box (which shifts capitals upward).
 *
 *   ./gradlew :app:recordRoborazziDebug   # write/refresh golden images
 *   ./gradlew :app:verifyRoborazziDebug   # fail on visual diff (CI)
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "w411dp-h891dp")
class AvatarScreenshotTest {

    @get:Rule
    val composeRule = createComposeRule()

    private fun snapshot(name: String, content: @Composable () -> Unit) {
        composeRule.setContent {
            ConvocadosTheme(themeMode = ThemeMode.Light) {
                Surface { content() }
            }
        }
        composeRule.onRoot().captureRoboImage("src/test/screenshots/$name.png")
    }

    @Test
    fun avatar_light() = snapshot("avatar_light") {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf("Ana", "Igor", "João", "Guilherme", "Élia", "Tom").forEach { n ->
                    PlayerAvatar(
                        name = n,
                        image = null,
                        isMe = false,
                        onClick = {},
                        modifier = Modifier
                            .size(24.dp)
                            .clip(CircleShape)
                            .background(MaterialTheme.colorScheme.surfaceVariant),
                    )
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf("W", "Y", "Q", "V", "L").forEach { n ->
                    PlayerAvatar(
                        name = n,
                        image = null,
                        isMe = true,
                        onClick = {},
                        modifier = Modifier
                            .size(24.dp)
                            .clip(CircleShape)
                            .background(MaterialTheme.colorScheme.primary),
                    )
                }
            }
            Box(
                Modifier
                    .size(72.dp)
                    .clip(CircleShape)
                    .background(MaterialTheme.colorScheme.primaryContainer),
            ) {
                InitialAvatar(
                    name = "André",
                    color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(72.dp),
                    style = MaterialTheme.typography.headlineLarge,
                )
            }
        }
    }
}
