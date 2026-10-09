package dev.convocados.wear.ui.screen.games

import androidx.compose.ui.test.junit4.createComposeRule
import dev.convocados.wear.data.local.entity.WearGameEntity
import dev.convocados.wear.data.repository.WearGameRepository
import dev.convocados.wear.data.repository.WearScoreRepository
import dev.convocados.wear.ui.theme.ConvocadosWearTheme
import androidx.work.WorkManager
import io.mockk.coEvery
import io.mockk.mockk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit

@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "w200dp-h200dp-round")
class GamesScreenAutoNavTest {

    @get:Rule
    val composeRule = createComposeRule()

    private val repository = mockk<WearGameRepository>(relaxed = true)
    private val scoreRepository = mockk<WearScoreRepository>(relaxed = true)
    private val workManager = mockk<WorkManager>(relaxed = true)

    @Before
    fun setup() {
        // Unconfined so the ViewModel's flow collection settles without needing
        // the test scheduler to be pumped alongside the Compose rule's clock.
        Dispatchers.setMain(UnconfinedTestDispatcher())
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    /** #1204: the games list must never navigate away on its own — the user taps. */
    @Test
    fun `scorable suggested game does not navigate on first composition`() {
        val now = Instant.now()
        val scorableGame = makeGame("scorable", now.plus(30, ChronoUnit.MINUTES))

        coEvery { repository.observeGames() } returns flowOf(listOf(scorableGame))
        coEvery { repository.observeArchivedGames() } returns flowOf(emptyList())
        coEvery { scoreRepository.observePendingCount() } returns flowOf(0)
        coEvery { repository.refreshGames() } returns Result.success(Unit)

        val viewModel = GamesViewModel(repository, scoreRepository, workManager)
        var navigations = 0

        composeRule.setContent {
            ConvocadosWearTheme {
                GamesScreen(
                    viewModel = viewModel,
                    onGameSelected = { navigations++ },
                    onSignOut = {},
                )
            }
        }
        composeRule.waitForIdle()

        assertEquals("cold launch must land on the games list, not the score screen", 0, navigations)
    }

    private fun makeGame(id: String, time: Instant) = WearGameEntity(
        id = id,
        title = "Game $id",
        location = "Field",
        dateTime = time.atZone(ZoneOffset.UTC).format(DateTimeFormatter.ISO_DATE_TIME),
        sport = "Soccer",
        maxPlayers = 10,
        playerCount = 5,
        teamOneName = "Team 1",
        teamTwoName = "Team 2",
        isRecurring = false,
        archivedAt = null,
        type = "owned",
    )
}
