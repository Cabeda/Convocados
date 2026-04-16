package dev.convocados.wear.ui.screen.score

import app.cash.turbine.test
import dev.convocados.wear.data.local.entity.WearGameEntity
import dev.convocados.wear.data.local.entity.WearHistoryEntity
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

@OptIn(ExperimentalCoroutinesApi::class)
class ScoreViewModelTest {

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
        val viewModel = ScoreViewModel(repository, workManager)

        viewModel.uiState.test {
            val state = awaitItem()
            assertTrue(state.isLoading)
            assertNull(state.game)
            assertNull(state.history)
            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun `load fetches game and observes history`() = runTest {
        val game = makeGame("e1")
        val history = makeHistory("h1", "e1", 2, 1)

        coEvery { repository.getGame("e1") } returns game
        coEvery { repository.refreshHistory("e1") } returns Result.success(Unit)
        coEvery { repository.observeLatestHistory("e1") } returns flowOf(history)

        val viewModel = ScoreViewModel(repository, workManager)
        viewModel.load("e1")
        advanceUntilIdle()

        viewModel.uiState.test {
            val state = awaitItem()
            assertFalse(state.isLoading)
            assertEquals(game, state.game)
            assertEquals(history, state.history)
            assertEquals(2, state.scoreOne)
            assertEquals(1, state.scoreTwo)
            assertEquals("Red", state.teamOneName)
            assertEquals("Blue", state.teamTwoName)
            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun `load is idempotent for same eventId`() = runTest {
        coEvery { repository.getGame("e1") } returns makeGame("e1")
        coEvery { repository.refreshHistory("e1") } returns Result.success(Unit)
        coEvery { repository.observeLatestHistory("e1") } returns flowOf(makeHistory("h1", "e1", 0, 0))

        val viewModel = ScoreViewModel(repository, workManager)
        viewModel.load("e1")
        viewModel.load("e1")
        advanceUntilIdle()

        coVerify(exactly = 1) { repository.getGame("e1") }
    }

    @Test
    fun `updateScore increments team one`() = runTest {
        coEvery { repository.getGame("e1") } returns makeGame("e1")
        coEvery { repository.refreshHistory("e1") } returns Result.success(Unit)
        coEvery { repository.observeLatestHistory("e1") } returns flowOf(makeHistory("h1", "e1", 0, 0))

        val viewModel = ScoreViewModel(repository, workManager)
        viewModel.load("e1")
        advanceUntilIdle()

        viewModel.updateScore(Team.ONE, 1)

        viewModel.uiState.test {
            assertEquals(1, awaitItem().scoreOne)
            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun `updateScore decrements team two but not below zero`() = runTest {
        coEvery { repository.getGame("e1") } returns makeGame("e1")
        coEvery { repository.refreshHistory("e1") } returns Result.success(Unit)
        coEvery { repository.observeLatestHistory("e1") } returns flowOf(makeHistory("h1", "e1", 0, 0))

        val viewModel = ScoreViewModel(repository, workManager)
        viewModel.load("e1")
        advanceUntilIdle()

        viewModel.updateScore(Team.TWO, -1)

        viewModel.uiState.test {
            assertEquals(0, awaitItem().scoreTwo)
            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun `updateScore increments team two`() = runTest {
        coEvery { repository.getGame("e1") } returns makeGame("e1")
        coEvery { repository.refreshHistory("e1") } returns Result.success(Unit)
        coEvery { repository.observeLatestHistory("e1") } returns flowOf(makeHistory("h1", "e1", 0, 0))

        val viewModel = ScoreViewModel(repository, workManager)
        viewModel.load("e1")
        advanceUntilIdle()

        viewModel.updateScore(Team.TWO, 1)
        viewModel.updateScore(Team.TWO, 1)

        viewModel.uiState.test {
            assertEquals(2, awaitItem().scoreTwo)
            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun `updateScore auto-saves after debounce`() = runTest {
        val history = makeHistory("h1", "e1", 0, 0)
        coEvery { repository.getGame("e1") } returns makeGame("e1")
        coEvery { repository.refreshHistory("e1") } returns Result.success(Unit)
        coEvery { repository.observeLatestHistory("e1") } returns flowOf(history)
        coEvery { repository.submitScore(any(), any(), any(), any(), any(), any()) } returns Result.success(Unit)

        val viewModel = ScoreViewModel(repository, workManager)
        viewModel.load("e1")
        advanceUntilIdle()

        viewModel.updateScore(Team.ONE, 1)

        // Before debounce — not yet saved
        coVerify(exactly = 0) { repository.submitScore(any(), any(), any(), any(), any(), any()) }

        // After debounce (1s)
        advanceTimeBy(1100)
        advanceUntilIdle()

        coVerify { repository.submitScore("e1", "h1", 1, 0, "Red", "Blue") }
    }

    @Test
    fun `rapid score changes debounce to single save`() = runTest {
        val history = makeHistory("h1", "e1", 0, 0)
        coEvery { repository.getGame("e1") } returns makeGame("e1")
        coEvery { repository.refreshHistory("e1") } returns Result.success(Unit)
        coEvery { repository.observeLatestHistory("e1") } returns flowOf(history)
        coEvery { repository.submitScore(any(), any(), any(), any(), any(), any()) } returns Result.success(Unit)

        val viewModel = ScoreViewModel(repository, workManager)
        viewModel.load("e1")
        advanceUntilIdle()

        // Rapid taps
        viewModel.updateScore(Team.ONE, 1)
        advanceTimeBy(200)
        viewModel.updateScore(Team.ONE, 1)
        advanceTimeBy(200)
        viewModel.updateScore(Team.ONE, 1)

        // Wait for debounce
        advanceTimeBy(1100)
        advanceUntilIdle()

        // Should only save once with final score
        coVerify(exactly = 1) { repository.submitScore("e1", "h1", 3, 0, "Red", "Blue") }
    }

    @Test
    fun `auto-save does nothing without history`() = runTest {
        coEvery { repository.getGame("e1") } returns makeGame("e1")
        coEvery { repository.refreshHistory("e1") } returns Result.success(Unit)
        coEvery { repository.observeLatestHistory("e1") } returns flowOf(null)

        val viewModel = ScoreViewModel(repository, workManager)
        viewModel.load("e1")
        advanceUntilIdle()

        viewModel.updateScore(Team.ONE, 1)
        advanceTimeBy(1100)
        advanceUntilIdle()

        coVerify(exactly = 0) { repository.submitScore(any(), any(), any(), any(), any(), any()) }
    }

    // ── Helpers ──────────────────────────────────────────────────────────

    private fun makeGame(id: String) = WearGameEntity(
        id = id,
        title = "Game $id",
        location = "Field",
        dateTime = "2025-01-01T10:00:00Z",
        sport = "Soccer",
        maxPlayers = 10,
        playerCount = 5,
        teamOneName = "Team 1",
        teamTwoName = "Team 2",
        isRecurring = false,
        type = "owned",
    )

    private fun makeHistory(id: String, eventId: String, scoreOne: Int, scoreTwo: Int) =
        WearHistoryEntity(
            id = id,
            eventId = eventId,
            dateTime = "2025-01-01T10:00:00Z",
            scoreOne = scoreOne,
            scoreTwo = scoreTwo,
            teamOneName = "Red",
            teamTwoName = "Blue",
            editable = true,
        )
}
