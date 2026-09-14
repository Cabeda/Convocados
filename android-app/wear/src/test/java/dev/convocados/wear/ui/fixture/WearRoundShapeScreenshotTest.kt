package dev.convocados.wear.ui.fixture

import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onRoot
import com.github.takahirom.roborazzi.captureRoboImage
import dev.convocados.wear.data.local.entity.WearGameEntity
import dev.convocados.wear.data.local.entity.WearHistoryEntity
import dev.convocados.wear.ui.screen.score.ScoreFixtureContent
import dev.convocados.wear.ui.screen.score.ScoreUiState
import dev.convocados.wear.ui.theme.ConvocadosWearTheme
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.time.Instant

/**
 * Play quality gate: watch shapes. Renders the densest screens on a small
 * round watch (192dp, round) so clipped text / edge-to-edge overflow fails
 * review before it reaches Play. Outputs go to screenshots/shape (not the
 * store-listing dir, which must stay exactly 4 files).
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "w192dp-h192dp-round")
class WearRoundShapeScreenshotTest {

    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun games_roundSmall() = snapshot("games-round-small") {
        WearGamesFixtureContent(games = FixtureData.games, pendingSyncCount = 1, now = FixtureData.now)
    }

    @Test
    fun gamesEmpty_roundSmall() = snapshot("games-empty-round-small") {
        WearGamesFixtureContent(games = emptyList(), now = FixtureData.now)
    }

    @Test
    fun liveScore_roundSmall() = snapshot("live-score-round-small") {
        ScoreFixtureContent(state = FixtureData.liveScore, now = FixtureData.now)
    }

    @Test
    fun history_roundSmall() = snapshot("history-round-small") {
        WearHistoryFixtureContent(FixtureData.history, now = FixtureData.now)
    }

    private fun snapshot(name: String, content: @androidx.compose.runtime.Composable () -> Unit) {
        composeRule.setContent {
            ConvocadosWearTheme(content = content)
        }
        composeRule.onRoot().captureRoboImage("src/test/screenshots/shape/$name.png")
    }

    private object FixtureData {
        val now: Instant = Instant.parse("2026-08-28T10:30:00Z")
        private fun game(id: String, title: String, dateTime: String, teamOne: String, teamTwo: String) =
            WearGameEntity(
                id = id,
                title = title,
                location = "Local court with a very long name that must ellipsize",
                dateTime = dateTime,
                sport = "futsal",
                maxPlayers = 10,
                playerCount = 8,
                teamOneName = teamOne,
                teamTwoName = teamTwo,
                isRecurring = false,
                type = "owned",
                cachedAt = 1_756_384_200_000L,
            )

        val games = listOf(
            game(
                "fixture-live",
                "Friday Futsal with an extra long title for clipping",
                "2026-08-28T10:15:00Z",
                "Northside Athletic Club",
                "Riverside United FC",
            ),
            game("fixture-upcoming", "Evening Five-a-side", "2026-08-28T12:00:00Z", "Blue", "Gold"),
        )

        val liveScore = ScoreUiState(
            game = games[0],
            history = WearHistoryEntity(
                id = "fixture-live-history",
                eventId = games[0].id,
                dateTime = games[0].dateTime,
                scoreOne = 12,
                scoreTwo = 8,
                teamOneName = games[0].teamOneName,
                teamTwoName = games[0].teamTwoName,
                editable = true,
            ),
            scoreOne = 12,
            scoreTwo = 8,
            teamOneName = games[0].teamOneName,
            teamTwoName = games[0].teamTwoName,
            isLoading = false,
            isOfflineQueued = true,
            kickoffEpochMs = Instant.parse(games[0].dateTime).toEpochMilli(),
        )

        val history = listOf(
            liveScore.history!!,
            WearHistoryEntity(
                id = "fixture-history-previous",
                eventId = "fixture-previous",
                dateTime = "2026-08-28T08:00:00Z",
                scoreOne = 1,
                scoreTwo = 1,
                teamOneName = "Harbor Athletic Club Long Name",
                teamTwoName = "United Riverside FC Long Name",
                editable = false,
            ),
        )
    }
}
