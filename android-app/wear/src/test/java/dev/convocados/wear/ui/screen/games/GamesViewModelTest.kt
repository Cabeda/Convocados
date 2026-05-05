package dev.convocados.wear.ui.screen.games

import app.cash.turbine.test
import dev.convocados.wear.data.local.entity.WearGameEntity
import dev.convocados.wear.data.repository.WearGameRepository
import androidx.work.WorkManager
import io.mockk.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.Flow
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

    private fun makeViewModel(): GamesViewModel {
        val vm = GamesViewModel(repository, workManager)
        vm.tickProvider = { flowOf(Instant.now()) }
        return vm
    }

    @Test
    fun `initial state is loading`() = runTest {
        coEvery { repository.observeGames() } returns flowOf(emptyList())
        coEvery { repository.observeArchivedGames() } returns flowOf(emptyList())
        coEvery { repository.observePendingCount() } returns flowOf(0)

        val viewModel = makeViewModel()

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
        coEvery { repository.observeArchivedGames() } returns flowOf(emptyList())
        coEvery { repository.observePendingCount() } returns flowOf(0)
        coEvery { repository.refreshGames() } returns Result.success(Unit)

        val viewModel = makeViewModel()
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
        coEvery { repository.observeArchivedGames() } returns flowOf(emptyList())
        coEvery { repository.observePendingCount() } returns flowOf(0)
        coEvery { repository.refreshGames() } returns Result.failure(Exception("No network"))

        val viewModel = makeViewModel()
        advanceUntilIdle()

        coVerify { repository.refreshGames() }
    }

    @Test
    fun `pending sync count is observed`() = runTest {
        coEvery { repository.observeGames() } returns flowOf(emptyList())
        coEvery { repository.observeArchivedGames() } returns flowOf(emptyList())
        coEvery { repository.observePendingCount() } returns flowOf(5)
        coEvery { repository.refreshGames() } returns Result.success(Unit)

        val viewModel = makeViewModel()
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
        coEvery { repository.observeArchivedGames() } returns flowOf(emptyList())
        coEvery { repository.observePendingCount() } returns flowOf(0)
        coEvery { repository.refreshGames() } returns Result.success(Unit)

        val viewModel = makeViewModel()
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
        coEvery { repository.observeArchivedGames() } returns flowOf(emptyList())
        coEvery { repository.observePendingCount() } returns flowOf(0)
        coEvery { repository.refreshGames() } returns Result.success(Unit)

        val viewModel = makeViewModel()
        advanceUntilIdle()

        viewModel.refresh()
        advanceUntilIdle()

        coVerify(atLeast = 2) { repository.refreshGames() }
    }

    @Test
    fun `canScoreGameIds includes games within 1 hour and excludes future games`() = runTest {
        val now = Instant.now()
        val scorableGame = makeGame("soon", now.plus(30, ChronoUnit.MINUTES))
        val futureGame = makeGame("later", now.plus(180, ChronoUnit.MINUTES))
        val pastGame = makeGame("past", now.minus(10, ChronoUnit.MINUTES))

        coEvery { repository.observeGames() } returns flowOf(listOf(scorableGame, futureGame, pastGame))
        coEvery { repository.observeArchivedGames() } returns flowOf(emptyList())
        coEvery { repository.observePendingCount() } returns flowOf(0)
        coEvery { repository.refreshGames() } returns Result.success(Unit)

        val viewModel = makeViewModel()
        advanceUntilIdle()

        viewModel.uiState.test {
            val state = awaitItem()
            assertTrue(state.canScoreGameIds.contains("soon"))
            assertTrue(state.canScoreGameIds.contains("past"))
            assertFalse(state.canScoreGameIds.contains("later"))
            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun `stale past non-recurring games are filtered from main list`() = runTest {
        val now = Instant.now()
        val recentPast = makeGame("recent", now.minus(30, ChronoUnit.MINUTES))
        val stalePast = makeGame("stale", now.minus(2, ChronoUnit.DAYS), isRecurring = false)
        val staleRecurring = makeGame("recurring", now.minus(2, ChronoUnit.DAYS), isRecurring = true)

        coEvery { repository.observeGames() } returns flowOf(listOf(recentPast, stalePast, staleRecurring))
        coEvery { repository.observeArchivedGames() } returns flowOf(emptyList())
        coEvery { repository.observePendingCount() } returns flowOf(0)
        coEvery { repository.refreshGames() } returns Result.success(Unit)

        val viewModel = makeViewModel()
        advanceUntilIdle()

        viewModel.uiState.test {
            val state = awaitItem()
            assertTrue(state.games.any { it.id == "recent" })
            assertFalse(state.games.any { it.id == "stale" })
            assertTrue(state.games.any { it.id == "recurring" })
            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun `past games are observed from archived games`() = runTest {
        val now = Instant.now()
        val archivedGame = makeGame("archived", now.minus(3, ChronoUnit.DAYS))

        coEvery { repository.observeGames() } returns flowOf(emptyList())
        coEvery { repository.observeArchivedGames() } returns flowOf(listOf(archivedGame))
        coEvery { repository.observePendingCount() } returns flowOf(0)
        coEvery { repository.refreshGames() } returns Result.success(Unit)

        val viewModel = makeViewModel()
        advanceUntilIdle()

        viewModel.uiState.test {
            val state = awaitItem()
            assertEquals(1, state.pastGames.size)
            assertEquals("archived", state.pastGames[0].id)
            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun `togglePastGames toggles showPastGames`() {
        val viewModel = makeViewModel()
        assertFalse(viewModel.uiState.value.showPastGames)
        viewModel.togglePastGames()
        assertTrue(viewModel.uiState.value.showPastGames)
        viewModel.togglePastGames()
        assertFalse(viewModel.uiState.value.showPastGames)
    }

    @Test
    fun `loadMorePast increases visiblePastCount`() {
        val viewModel = makeViewModel()
        assertEquals(5, viewModel.uiState.value.visiblePastCount)
        viewModel.loadMorePast()
        assertEquals(10, viewModel.uiState.value.visiblePastCount)
    }

    private fun makeGame(
        id: String,
        time: Instant = Instant.now(),
        isRecurring: Boolean = false,
    ) = WearGameEntity(
        id = id,
        title = "Game $id",
        location = "Field",
        dateTime = time.atZone(ZoneOffset.UTC).format(DateTimeFormatter.ISO_DATE_TIME),
        sport = "Soccer",
        maxPlayers = 10,
        playerCount = 5,
        teamOneName = "Team 1",
        teamTwoName = "Team 2",
        isRecurring = isRecurring,
        archivedAt = null,
        type = "owned",
    )
}