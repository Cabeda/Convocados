package dev.convocados.ui.screen.event

import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.unit.dp
import com.github.takahirom.roborazzi.captureRoboImage
import dev.convocados.data.api.TeamMember
import dev.convocados.data.api.TeamResult
import dev.convocados.ui.theme.ConvocadosTheme
import dev.convocados.ui.theme.ThemeMode
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "w411dp-h891dp")
class TeamFieldViewScreenshotTest {

    @get:Rule
    val composeRule = createComposeRule()

    private val teams = listOf(
        TeamResult(
            "t1", "Whites",
            listOf(
                TeamMember("p1", "Marta", 0),
                TeamMember("p3", "Alex", 1),
                TeamMember("p5", "Rui", 2),
                TeamMember("p7", "Nina", 3),
                TeamMember("p9", "Paulo", 4),
            ),
        ),
        TeamResult(
            "t2", "Blues",
            listOf(
                TeamMember("p2", "João", 0),
                TeamMember("p4", "Sofia", 1),
                TeamMember("p6", "Tiago", 2),
                TeamMember("p8", "Ana", 3),
                TeamMember("p10", "Luís", 4),
            ),
        ),
    )

    private val ratings = mapOf(
        "Marta" to 1200, "Alex" to 1100, "Rui" to 1000, "Nina" to 1150, "Paulo" to 980,
        "João" to 1300, "Sofia" to 1080, "Tiago" to 1010, "Ana" to 990, "Luís" to 1120,
    )

    private fun snapshot(name: String, dark: Boolean) {
        composeRule.setContent {
            ConvocadosTheme(themeMode = if (dark) ThemeMode.Dark else ThemeMode.Light) {
                Surface {
                    TeamFieldView(
                        teams = teams,
                        sport = "football-5v5",
                        ratings = ratings,
                        playerIds = teams.flatMap { it.members }.associate { it.name to it.id },
                        canEdit = true,
                        onMove = { _, _, _ -> },
                        modifier = Modifier.padding(12.dp),
                    )
                }
            }
        }
        composeRule.onRoot().captureRoboImage("src/test/screenshots/$name.png")
    }

    @Test
    fun teamField_light() = snapshot("team_field_light", dark = false)

    @Test
    fun teamField_dark() = snapshot("team_field_dark", dark = true)
}
