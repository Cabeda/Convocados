package dev.convocados.ui.screen.event

import app.cash.turbine.test
import dev.convocados.data.api.*
import dev.convocados.data.auth.TokenStore
import dev.convocados.data.repository.EventRepository
import io.mockk.coEvery
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
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class EventDetailViewModelTest {
    private val repository = mockk<EventRepository>(relaxed = true)
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
        viewModel.load(eventId)
        
        viewModel.event.test {
            assertEquals(mockEvent, awaitItem())
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
        viewModel.load(eventId)
        
        viewModel.state.test {
            val state = awaitItem()
            assertEquals(true, state.locked)
            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun `addPlayer calls api and reloads event`() = runTest {
        coEvery { repository.getEventDetail(eventId) } returns flowOf(mockEvent)
        coEvery { repository.getPlayers(eventId) } returns flowOf(emptyList())
        coEvery { repository.getHistory(eventId) } returns flowOf(emptyList())
        coEvery { repository.addPlayer(eventId, "New Player", true) } returns Result.success(Unit)

        val viewModel = EventDetailViewModel(repository, api, tokenStore)
        viewModel.addPlayer(eventId, "New Player")
        advanceUntilIdle()

        coVerify { repository.addPlayer(eventId, "New Player", true) }
    }

    @Test
    fun `removePlayer sets undo data and reloads`() = runTest {
        coEvery { repository.getEventDetail(eventId) } returns flowOf(mockEvent)
        coEvery { repository.getPlayers(eventId) } returns flowOf(emptyList())
        coEvery { repository.getHistory(eventId) } returns flowOf(emptyList())
        val undo = UndoData(name = "Player One", order = 1, userId = "p-1", removedAt = 123456789L)
        coEvery { repository.removePlayer(eventId, "p-1") } returns Result.success(undo)

        val viewModel = EventDetailViewModel(repository, api, tokenStore)
        viewModel.load(eventId)
        viewModel.removePlayer(eventId, "p-1")
        
        viewModel.state.test {
            val item = awaitItem()
            assertEquals(undo, item.undoData)
            cancelAndIgnoreRemainingEvents()
        }
        coVerify { repository.removePlayer(eventId, "p-1") }
    }

    @Test
    fun `verifyPassword unlocks event on success`() = runTest {
        coEvery { repository.getEventDetail(eventId) } returns flowOf(mockEvent.copy(locked = true))
        coEvery { repository.getPlayers(eventId) } returns flowOf(emptyList())
        coEvery { repository.getHistory(eventId) } returns flowOf(emptyList())
        coEvery { repository.verifyPassword(eventId, "secret") } returns Result.success(Unit)

        val viewModel = EventDetailViewModel(repository, api, tokenStore)
        viewModel.load(eventId)
        
        viewModel.state.test {
            val initialState = awaitItem()
            assertEquals(true, initialState.locked)
            
            viewModel.verifyPassword(eventId, "secret")
            
            assertEquals(false, awaitItem().locked)
            cancelAndIgnoreRemainingEvents()
        }
        coVerify { repository.verifyPassword(eventId, "secret") }
    }
}
