package dev.convocados.ui.components

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.unit.dp
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
 * Roborazzi screenshot tests — JVM-only (Robolectric), no device required.
 *
 *   ./gradlew :app:recordRoborazziDebug   # write/refresh golden images
 *   ./gradlew :app:verifyRoborazziDebug   # fail on visual diff (CI)
 *
 * Goldens live under app/src/test/screenshots.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "w411dp-h891dp")
class ComponentScreenshotTest {

    @get:Rule
    val composeRule = createComposeRule()

    private fun snapshot(name: String, dark: Boolean, content: @androidx.compose.runtime.Composable () -> Unit) {
        composeRule.setContent {
            ConvocadosTheme(themeMode = if (dark) ThemeMode.Dark else ThemeMode.Light) {
                Surface { content() }
            }
        }
        composeRule.onRoot().captureRoboImage("src/test/screenshots/$name.png")
    }

    @Test
    fun componentLibrary_light() = snapshot("component_library_light", dark = false) { Library() }

    @Test
    fun componentLibrary_dark() = snapshot("component_library_dark", dark = true) { Library() }

    @androidx.compose.runtime.Composable
    private fun Library() {
        Column(Modifier.padding(16.dp)) {
            SectionHeader("OVERVIEW")
            StatRow(tiles = listOf("Games" to "42", "Wins" to "27", "Draws" to "5"))
            SectionHeader("PER EVENT")
            SectionCard {
                Text("Tuesday 5-a-side", style = MaterialTheme.typography.titleMedium)
                Text("12 games · Rating 1180", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}
