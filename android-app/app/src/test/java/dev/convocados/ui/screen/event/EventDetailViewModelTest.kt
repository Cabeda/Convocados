package dev.convocados.ui.screen.event

import app.cash.turbine.test
import dev.convocados.data.api.*
import dev.convocados.data.auth.TokenStore
import dev.convocados.data.repository.EventRepository
import io.mockk.coEvery
import io.mockk.coJustRun
import kotlinx.coroutines.flow.flowOf
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.*
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Ignore
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class EventDetailViewModelTest {
    private val repository = mockk<EventRepository>(relaxUnitFun = true)
    private val api = mockk<ConvocadosApi>(relaxed = true)
    private val tokenStore = mockk<TokenStore>(relaxed = true)
    private val testDispatcher = StandardTestDispatcher()

    private val eventId = "event-123"
    private val mockEvent = EventDetail(
        id = eventId,
        title = "Test Event",
        location = "Test Location",
        dateTime = "2024-01-01T10:00:00Z",
        maxPlayers = 10,
        players = emptyList(),
        ownerId = "user-1",
        isAdmin = true
    )

    @Before
    fun setup() {
        Dispatchers.setMain(testDispatcher)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun `load fetches event details and history`() = runTest {
        coEvery { repository.getEventDetail(eventId) } returns flowOf(mockEvent)
        coEvery { repository.getPlayers(eventId) } returns flowOf(emptyList())
        coEvery { repository.getHistory(eventId) } returns flowOf(emptyList())

        val viewModel = EventDetailViewModel(repository, api, tokenStore)

        viewModel.event.test {
            viewModel.load(eventId)
            advanceUntilIdle()
            assertEquals(mockEvent, expectMostRecentItem())
            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun `load sets locked state when event is password protected`() = runTest {
        val lockedEvent = mockEvent.copy(locked = true)
        coEvery { repository.getEventDetail(eventId) } returns flowOf(lockedEvent)
        coEvery { repository.getPlayers(eventId) } returns flowOf(emptyList())
        coEvery { repository.getHistory(eventId) } returns flowOf(emptyList())

        val viewModel = EventDetailViewModel(repository, api, tokenStore)

        viewModel.state.test {
            viewModel.load(eventId)
            advanceUntilIdle()
            assertEquals(true, expectMostRecentItem().locked)
            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun `addPlayer calls api and reloads event`() = runTest {
        coEvery { repository.getEventDetail(eventId) } returns flowOf(mockEvent)
        coEvery { repository.getPlayers(eventId) } returns flowOf(emptyList())
        coEvery { repository.getHistory(eventId) } returns flowOf(emptyList())
        coEvery { repository.addPlayer(eventId, "New Player", true) } coAnswers { Result.success(Unit) }

        val viewModel = EventDetailViewModel(repository, api, tokenStore)
        viewModel.addPlayer(eventId, "New Player")
        advanceUntilIdle()

        coVerify { repository.addPlayer(eventId, "New Player", true) }
    }

    @Ignore("MockK cannot handle kotlin.Result inline class — ClassCastException at runtime (pre-existing)")
    @Test
    fun `removePlayer calls repository`() = runTest {
        coEvery { repository.getEventDetail(eventId) } returns flowOf(mockEvent)
        coEvery { repository.getPlayers(eventId) } returns flowOf(emptyList())
        coEvery { repository.getHistory(eventId) } returns flowOf(emptyList())
        val undo = UndoData(name = "Player One", order = 1, userId = "p-1", removedAt = 123456789L)
        coEvery { repository.removePlayer(eventId, "p-1") } returns Result.success(undo)

        val viewModel = EventDetailViewModel(repository, api, tokenStore)
        viewModel.removePlayer(eventId, "p-1")
        advanceUntilIdle()

        coVerify { repository.removePlayer(eventId, "p-1") }
    }

    @Ignore("MockK cannot handle kotlin.Result inline class — ClassCastException at runtime (pre-existing)")
    @Test
    fun `verifyPassword calls repository`() = runTest {
        coEvery { repository.getEventDetail(eventId) } returns flowOf(mockEvent.copy(locked = true))
        coEvery { repository.getPlayers(eventId) } returns flowOf(emptyList())
        coEvery { repository.getHistory(eventId) } returns flowOf(emptyList())
        coEvery { repository.verifyPassword(eventId, "secret") } returns Result.success(Unit)

        val viewModel = EventDetailViewModel(repository, api, tokenStore)
        viewModel.verifyPassword(eventId, "secret")
        advanceUntilIdle()

        coVerify { repository.verifyPassword(eventId, "secret") }
    }

    @Test
    fun `load fetches post-game status and exposes it in state`() = runTest {
        coEvery { repository.getEventDetail(eventId) } returns flowOf(mockEvent)
        coEvery { repository.getPlayers(eventId) } returns flowOf(emptyList())
        coEvery { repository.getHistory(eventId) } returns flowOf(emptyList())

        val postGame = PostGameStatus(
            gameEnded = true,
            hasScore = false,
            hasCost = true,
            allPaid = false,
            allComplete = false,
            isParticipant = true,
            latestHistoryId = "hist-1",
            hasPendingPastPayments = false,
        )
        coEvery { api.fetchPostGameStatus(eventId) } returns postGame

        val viewModel = EventDetailViewModel(repository, api, tokenStore)

        viewModel.state.test {
            viewModel.load(eventId)
            advanceUntilIdle()
            val state = expectMostRecentItem()
            assertNotNull(state.postGame)
            assertEquals(true, state.postGame?.gameEnded)
            assertEquals(false, state.postGame?.hasScore)
            assertEquals(true, state.postGame?.hasCost)
            assertEquals(false, state.postGame?.allPaid)
            assertEquals("hist-1", state.postGame?.latestHistoryId)
            cancelAndIgnoreRemainingEvents()
        }
        coVerify { api.fetchPostGameStatus(eventId) }
    }

    @Test
    fun `load handles post-game status fetch failure gracefully`() = runTest {
        coEvery { repository.getEventDetail(eventId) } returns flowOf(mockEvent)
        coEvery { repository.getPlayers(eventId) } returns flowOf(emptyList())
        coEvery { repository.getHistory(eventId) } returns flowOf(emptyList())
        coEvery { api.fetchPostGameStatus(eventId) } throws RuntimeException("Network error")

        val viewModel = EventDetailViewModel(repository, api, tokenStore)

        viewModel.state.test {
            viewModel.load(eventId)
            advanceUntilIdle()
            assertNull(expectMostRecentItem().postGame)
            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun `refresh re-fetches post-game status`() = runTest {
        coEvery { repository.getEventDetail(eventId) } returns flowOf(mockEvent)
        coEvery { repository.getPlayers(eventId) } returns flowOf(emptyList())
        coEvery { repository.getHistory(eventId) } returns flowOf(emptyList())

        val postGame = PostGameStatus(gameEnded = true, hasScore = true, allPaid = true, allComplete = true)
        coEvery { api.fetchPostGameStatus(eventId) } returns postGame

        val viewModel = EventDetailViewModel(repository, api, tokenStore)

        viewModel.state.test {
            viewModel.load(eventId)
            advanceUntilIdle()

            viewModel.refresh(eventId)
            advanceUntilIdle()
            cancelAndIgnoreRemainingEvents()
        }
        coVerify(exactly = 2) { api.fetchPostGameStatus(eventId) }
    }
}
