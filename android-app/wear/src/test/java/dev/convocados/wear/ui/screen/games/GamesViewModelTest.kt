package dev.convocados.wear.ui.screen.games

import app.cash.turbine.test
import dev.convocados.wear.data.local.entity.WearGameEntity
import dev.convocados.wear.data.repository.WearGameRepository
import androidx.work.WorkManager
import io.mockk.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.*
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit

@OptIn(ExperimentalCoroutinesApi::class)
class GamesViewModelTest {

    private val repository = mockk<WearGameRepository>(relaxed = true)
    private val workManager = mockk<WorkManager>(relaxed = true)
    private val testDispatcher = StandardTestDispatcher()

    @Before
    fun setup() {
        Dispatchers.setMain(testDispatcher)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun `initial state is loading`() = runTest {
        coEvery { repository.observeGames() } returns flowOf(emptyList())
        coEvery { repository.observePendingCount() } returns flowOf(0)

        val viewModel = GamesViewModel(repository, workManager)

        viewModel.uiState.test {
            val initial = awaitItem()
            assertTrue(initial.isLoading)
            assertTrue(initial.games.isEmpty())
            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun `games are loaded from repository`() = runTest {
        val games = listOf(makeGame("1"), makeGame("2"))
        coEvery { repository.observeGames() } returns flowOf(games)
        coEvery { repository.observePendingCount() } returns flowOf(0)
        coEvery { repository.refreshGames() } returns Result.success(Unit)

        val viewModel = GamesViewModel(repository, workManager)
        advanceUntilIdle()

        viewModel.uiState.test {
            val state = awaitItem()
            assertEquals(2, state.games.size)
            assertFalse(state.isLoading)
            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun `refresh sets isOffline on failure`() = runTest {
        coEvery { repository.observeGames() } returns flowOf(emptyList())
        coEvery { repository.observePendingCount() } returns flowOf(0)
        coEvery { repository.refreshGames() } returns Result.failure(Exception("No network"))

        val viewModel = GamesViewModel(repository, workManager)
        advanceUntilIdle()

        viewModel.uiState.test {
            val state = awaitItem()
            assertTrue(state.isOffline)
            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun `pending sync count is observed`() = runTest {
        coEvery { repository.observeGames() } returns flowOf(emptyList())
        coEvery { repository.observePendingCount() } returns flowOf(5)
        coEvery { repository.refreshGames() } returns Result.success(Unit)

        val viewModel = GamesViewModel(repository, workManager)
        advanceUntilIdle()

        viewModel.uiState.test {
            val state = awaitItem()
            assertEquals(5, state.pendingSyncCount)
            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun `suggestedGameId picks game closest to now`() = runTest {
        val now = Instant.now()
        val soonGame = makeGame("soon", now.plus(10, ChronoUnit.MINUTES))
        val laterGame = makeGame("later", now.plus(300, ChronoUnit.MINUTES))

        coEvery { repository.observeGames() } returns flowOf(listOf(soonGame, laterGame))
        coEvery { repository.observePendingCount() } returns flowOf(0)
        coEvery { repository.refreshGames() } returns Result.success(Unit)

        val viewModel = GamesViewModel(repository, workManager)
        advanceUntilIdle()

        viewModel.uiState.test {
            val state = awaitItem()
            assertEquals("soon", state.suggestedGameId)
            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun `refresh calls repository refreshGames`() = runTest {
        coEvery { repository.observeGames() } returns flowOf(emptyList())
        coEvery { repository.observePendingCount() } returns flowOf(0)
        coEvery { repository.refreshGames() } returns Result.success(Unit)

        val viewModel = GamesViewModel(repository, workManager)
        advanceUntilIdle()

        viewModel.refresh()
        advanceUntilIdle()

        // init calls refresh once, then we call it again
        coVerify(atLeast = 2) { repository.refreshGames() }
    }

    // ── Helpers ──────────────────────────────────────────────────────────

    private fun makeGame(id: String, time: Instant = Instant.now()) = WearGameEntity(
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
        type = "owned",
    )
}
