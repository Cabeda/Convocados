package dev.convocados.wear.ui.screen.quick

import dev.convocados.wear.data.api.GameHistory
import dev.convocados.wear.data.api.ScoreRequest
import dev.convocados.wear.data.api.SetScore
import dev.convocados.wear.data.api.WatchGameResponse
import dev.convocados.wear.data.api.WearApiClient
import dev.convocados.wear.data.local.QuickGameState
import dev.convocados.wear.data.local.QuickGameStore
import dev.convocados.wear.data.local.entity.WearGameEntity
import dev.convocados.wear.data.repository.WearGameRepository
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import io.mockk.verify
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class SaveQuickGameViewModelTest {

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
    fun `successful save clears quick state and refreshes event history`() = runTest {
        val quick = QuickGameState(scoreOne = 3, scoreTwo = 2, kickoffEpochMs = 1L)
        val store = mockk<QuickGameStore>(relaxed = true)
        every { store.state } returns MutableStateFlow(quick)
        val repository = mockk<WearGameRepository>()
        every { repository.observeGames() } returns flowOf(listOf(event()))
        coEvery { repository.refreshHistory("event-1") } returns Result.success(Unit)
        val client = mockk<WearApiClient>()
        coEvery { client.createWatchGameHistory("event-1") } returns WatchGameResponse("history-1")
        coEvery { client.patchGameHistory(any(), any()) } returns GameHistory("history-1", "2025-01-01T00:00:00Z")

        val viewModel = SaveQuickGameViewModel(client, store, repository)
        viewModel.load()
        advanceUntilIdle()
        viewModel.saveTo("event-1")
        advanceUntilIdle()

        verify(exactly = 1) { store.clear() }
        coVerify(exactly = 1) { repository.refreshHistory("event-1") }
        assertTrue(viewModel.uiState.value.saved)
        assertTrue(viewModel.uiState.value.error == null)
    }

    @Test
    fun `back to back save requests submit only once`() = runTest {
        val quick = QuickGameState(scoreOne = 3, scoreTwo = 2, kickoffEpochMs = 1L)
        val store = mockk<QuickGameStore>(relaxed = true)
        every { store.state } returns MutableStateFlow(quick)
        val repository = mockk<WearGameRepository>()
        every { repository.observeGames() } returns flowOf(listOf(event()))
        coEvery { repository.refreshHistory("event-1") } returns Result.success(Unit)
        val client = mockk<WearApiClient>()
        coEvery { client.createWatchGameHistory("event-1") } returns WatchGameResponse("history-1")
        coEvery { client.patchGameHistory(any(), any()) } returns GameHistory("history-1", "2025-01-01T00:00:00Z")

        val viewModel = SaveQuickGameViewModel(client, store, repository)
        viewModel.load()
        advanceUntilIdle()
        viewModel.saveTo("event-1")
        viewModel.saveTo("event-1")
        advanceUntilIdle()

        coVerify(exactly = 1) { client.createWatchGameHistory("event-1") }
        coVerify(exactly = 1) {
            client.patchGameHistory(
                "/api/events/event-1/history/history-1",
                ScoreRequest(3, 2),
            )
        }
    }

    @Test
    fun `concurrent save requests submit only once`() = runTest {
        val quick = QuickGameState(scoreOne = 3, scoreTwo = 2, kickoffEpochMs = 1L)
        val store = mockk<QuickGameStore>(relaxed = true)
        every { store.state } returns MutableStateFlow(quick)
        val repository = mockk<WearGameRepository>()
        every { repository.observeGames() } returns flowOf(listOf(event()))
        coEvery { repository.refreshHistory("event-1") } returns Result.success(Unit)
        val client = mockk<WearApiClient>()
        coEvery { client.createWatchGameHistory("event-1") } returns WatchGameResponse("history-1")
        coEvery { client.patchGameHistory(any(), any()) } returns GameHistory("history-1", "2025-01-01T00:00:00Z")

        val viewModel = SaveQuickGameViewModel(client, store, repository)
        viewModel.load()
        advanceUntilIdle()
        listOf(
            async(Dispatchers.Default) { viewModel.saveTo("event-1") },
            async(Dispatchers.Default) { viewModel.saveTo("event-1") },
        ).awaitAll()
        advanceUntilIdle()

        coVerify(exactly = 1) { client.createWatchGameHistory("event-1") }
        coVerify(exactly = 1) {
            client.patchGameHistory(
                "/api/events/event-1/history/history-1",
                ScoreRequest(3, 2),
            )
        }
    }

    @Test
    fun `cache refresh failure does not invalidate accepted save`() = runTest {
        val quick = QuickGameState(scoreOne = 3, scoreTwo = 2, kickoffEpochMs = 1L)
        val store = mockk<QuickGameStore>(relaxed = true)
        every { store.state } returns MutableStateFlow(quick)
        val repository = mockk<WearGameRepository>()
        every { repository.observeGames() } returns flowOf(listOf(event()))
        coEvery { repository.refreshHistory("event-1") } throws IllegalStateException("cache unavailable")
        val client = mockk<WearApiClient>()
        coEvery { client.createWatchGameHistory("event-1") } returns WatchGameResponse("history-1")
        coEvery { client.patchGameHistory(any(), any()) } returns GameHistory("history-1", "2025-01-01T00:00:00Z")

        val viewModel = SaveQuickGameViewModel(client, store, repository)
        viewModel.load()
        advanceUntilIdle()
        viewModel.saveTo("event-1")
        advanceUntilIdle()

        verify(exactly = 1) { store.clear() }
        assertTrue(viewModel.uiState.value.saved)
        assertTrue(viewModel.uiState.value.error == null)
    }

    @Test
    fun `failed save preserves quick state and exposes retryable error`() = runTest {
        val quick = QuickGameState(scoreOne = 3, scoreTwo = 2, kickoffEpochMs = 1L)
        val store = mockk<QuickGameStore>(relaxed = true)
        every { store.state } returns MutableStateFlow(quick)
        val repository = mockk<WearGameRepository>()
        every { repository.observeGames() } returns flowOf(listOf(event()))
        val client = mockk<WearApiClient>()
        coEvery { client.createWatchGameHistory("event-1") } returns WatchGameResponse("history-1")
        coEvery {
            client.patchGameHistory(any(), any())
        } throws IllegalStateException("offline")

        val viewModel = SaveQuickGameViewModel(client, store, repository)
        viewModel.load()
        advanceUntilIdle()
        viewModel.saveTo("event-1")
        advanceUntilIdle()

        verify(exactly = 0) { store.clear() }
        assertFalse(viewModel.uiState.value.saved)
        assertEquals("Couldn't save quick game. Check your connection and try again.", viewModel.uiState.value.error)
    }

    @Test
    fun `save targets only known owner and admin events`() = runTest {
        val quick = QuickGameState(kickoffEpochMs = 1L)
        val store = mockk<QuickGameStore>(relaxed = true)
        every { store.state } returns MutableStateFlow(quick)
        val repository = mockk<WearGameRepository>()
        every { repository.observeGames() } returns flowOf(
            listOf(
                event(id = "owned", type = "owned"),
                event(id = "admin", type = "admin"),
                event(id = "followed", type = "followed"),
            ),
        )
        val client = mockk<WearApiClient>()
        val viewModel = SaveQuickGameViewModel(client, store, repository)
        viewModel.load()
        advanceUntilIdle()

        assertEquals(listOf("owned", "admin"), viewModel.uiState.value.events.map { it.id })
    }

    @Test
    fun `standard quick game excludes structured destination events`() = runTest {
        val quick = QuickGameState(kickoffEpochMs = 1L)
        val store = mockk<QuickGameStore>(relaxed = true)
        every { store.state } returns MutableStateFlow(quick)
        val repository = mockk<WearGameRepository>()
        every { repository.observeGames() } returns flowOf(
            listOf(
                event(id = "soccer", sport = "soccer"),
                event(id = "tennis", sport = "tennis"),
            ),
        )
        val client = mockk<WearApiClient>()
        val viewModel = SaveQuickGameViewModel(client, store, repository)
        viewModel.load()
        advanceUntilIdle()

        assertEquals(listOf("soccer"), viewModel.uiState.value.events.map { it.id })
    }

    @Test
    fun `saving structured quick game sends set scores`() = runTest {
        val quick = QuickGameState(
            sport = "tennis",
            scoreOne = 1,
            scoreTwo = 0,
            scoreSets = listOf(SetScore(6, 4)),
            kickoffEpochMs = 1L,
        )
        val store = mockk<QuickGameStore>(relaxed = true)
        every { store.state } returns MutableStateFlow(quick)
        val repository = mockk<WearGameRepository>()
        every { repository.observeGames() } returns flowOf(listOf(event(sport = "tennis")))
        val client = mockk<WearApiClient>()
        coEvery { client.createWatchGameHistory("event-1") } returns WatchGameResponse("history-1")
        coEvery { client.patchGameHistory(any(), any()) } returns GameHistory("history-1", "2025-01-01T00:00:00Z")
        coEvery { repository.refreshHistory("event-1") } returns Result.success(Unit)

        val viewModel = SaveQuickGameViewModel(client, store, repository)
        viewModel.load()
        advanceUntilIdle()
        viewModel.saveTo("event-1")
        advanceUntilIdle()

        coVerify {
            client.patchGameHistory(
                "/api/events/event-1/history/history-1",
                ScoreRequest(1, 0, listOf(SetScore(6, 4))),
            )
        }
        assertTrue(viewModel.uiState.value.saved)
    }

    @Test
    fun `saving standard quick game keeps scalar payload`() = runTest {
        val quick = QuickGameState(scoreOne = 3, scoreTwo = 2, kickoffEpochMs = 1L)
        val store = mockk<QuickGameStore>(relaxed = true)
        every { store.state } returns MutableStateFlow(quick)
        val repository = mockk<WearGameRepository>()
        every { repository.observeGames() } returns flowOf(listOf(event()))
        val client = mockk<WearApiClient>()
        coEvery { client.createWatchGameHistory("event-1") } returns WatchGameResponse("history-1")
        coEvery { client.patchGameHistory(any(), any()) } returns GameHistory("history-1", "2025-01-01T00:00:00Z")
        coEvery { repository.refreshHistory("event-1") } returns Result.success(Unit)

        val viewModel = SaveQuickGameViewModel(client, store, repository)
        viewModel.load()
        advanceUntilIdle()
        viewModel.saveTo("event-1")
        advanceUntilIdle()

        coVerify {
            client.patchGameHistory(
                "/api/events/event-1/history/history-1",
                ScoreRequest(3, 2),
            )
        }
    }

    @Test
    fun `structured quick game excludes non tennis destination events`() = runTest {
        val quick = QuickGameState(sport = "padel", kickoffEpochMs = 1L)
        val store = mockk<QuickGameStore>(relaxed = true)
        every { store.state } returns MutableStateFlow(quick)
        val repository = mockk<WearGameRepository>()
        every { repository.observeGames() } returns flowOf(
            listOf(event(id = "soccer", sport = "soccer"), event(id = "padel", sport = "padel")),
        )
        val client = mockk<WearApiClient>()
        val viewModel = SaveQuickGameViewModel(client, store, repository)
        viewModel.load()
        advanceUntilIdle()

        assertTrue(viewModel.uiState.value.events.single().id == "padel")
    }

    private fun event(
        id: String = "event-1",
        sport: String = "soccer",
        type: String = "owned",
    ) = WearGameEntity(
        id = id,
        title = "Event",
        location = "Field",
        dateTime = "2025-01-01T00:00:00Z",
        sport = sport,
        maxPlayers = 10,
        playerCount = 0,
        teamOneName = "Team 1",
        teamTwoName = "Team 2",
        isRecurring = false,
        archivedAt = null,
        type = type,
    )
}
