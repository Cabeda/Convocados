package dev.convocados.wear.ui.fixture

import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onRoot
import com.github.takahirom.roborazzi.captureRoboImage
import dev.convocados.wear.data.local.entity.WearGameEntity
import dev.convocados.wear.data.local.entity.WearHistoryEntity
import dev.convocados.wear.ui.screen.score.ScoreUiState
import dev.convocados.wear.ui.screen.score.ScoreFixtureContent
import dev.convocados.wear.ui.theme.ConvocadosWearTheme
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.time.Instant

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "w390dp-h390dp")
class WearFixtureScreenshotTest {

    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun games() = snapshot("games") {
        WearGamesFixtureContent(
            games = FixtureData.games,
            pendingSyncCount = 1,
            now = FixtureData.now,
        )
    }

    @Test
    fun liveScore() = snapshot("live_score") {
        ScoreFixtureContent(
            state = FixtureData.liveScore,
            now = FixtureData.now,
            onIncrementOne = {},
            onIncrementTwo = {},
            onDecrementOne = {},
            onDecrementTwo = {},
            onUndo = {},
        )
    }

    @Test
    fun quickGame() = snapshot("quick_game") {
        ScoreFixtureContent(
            state = FixtureData.quickGame,
            now = FixtureData.now,
            onIncrementOne = {},
            onIncrementTwo = {},
            onDecrementOne = {},
            onDecrementTwo = {},
            onUndo = {},
        )
    }

    @Test
    fun history() = snapshot("history") {
        WearHistoryFixtureContent(FixtureData.history, now = FixtureData.now)
    }

    private fun snapshot(name: String, content: @androidx.compose.runtime.Composable () -> Unit) {
        composeRule.setContent {
            ConvocadosWearTheme(content = content)
        }
        composeRule.onRoot().captureRoboImage("src/test/screenshots/store-listing/$name.png")
    }

    private object FixtureData {
        val now: Instant = Instant.parse("2026-08-28T10:30:00Z")
        private val liveGame = game(
            id = "fixture-live",
            title = "Friday Futsal",
            dateTime = "2026-08-28T10:15:00Z",
            teamOne = "Northside",
            teamTwo = "Riverside",
        )
        private val upcomingGame = game(
            id = "fixture-upcoming",
            title = "Evening Five-a-side",
            dateTime = "2026-08-28T12:00:00Z",
            teamOne = "Blue",
            teamTwo = "Gold",
        )
        private val cachedGame = game(
            id = "fixture-cached",
            title = "Saturday Training",
            dateTime = "2026-08-29T09:00:00Z",
            teamOne = "Squad A",
            teamTwo = "Squad B",
        )

        val games = listOf(liveGame, upcomingGame, cachedGame)

        val liveScore = ScoreUiState(
            game = liveGame,
            history = WearHistoryEntity(
                id = "fixture-live-history",
                eventId = liveGame.id,
                dateTime = liveGame.dateTime,
                scoreOne = 3,
                scoreTwo = 2,
                teamOneName = liveGame.teamOneName,
                teamTwoName = liveGame.teamTwoName,
                editable = true,
            ),
            scoreOne = 3,
            scoreTwo = 2,
            teamOneName = liveGame.teamOneName,
            teamTwoName = liveGame.teamTwoName,
            isLoading = false,
            isOfflineQueued = true,
            kickoffEpochMs = Instant.parse(liveGame.dateTime).toEpochMilli(),
        )

        val quickGame = liveScore.copy(
            game = liveGame.copy(id = "fixture-quick", title = "Quick Game · Futsal"),
            history = liveScore.history?.copy(id = "fixture-quick-history", eventId = "fixture-quick"),
            teamOneName = "Team One",
            teamTwoName = "Team Two",
        )

        val history = listOf(
            liveScore.history!!,
            WearHistoryEntity(
                id = "fixture-history-previous",
                eventId = "fixture-previous",
                dateTime = "2026-08-28T08:00:00Z",
                scoreOne = 1,
                scoreTwo = 1,
                teamOneName = "Harbor",
                teamTwoName = "United",
                editable = false,
            ),
        )

        private fun game(
            id: String,
            title: String,
            dateTime: String,
            teamOne: String,
            teamTwo: String,
        ) = WearGameEntity(
            id = id,
            title = title,
            location = "Local court",
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
    }
}
