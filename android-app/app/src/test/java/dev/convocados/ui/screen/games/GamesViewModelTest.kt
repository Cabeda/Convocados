package dev.convocados.ui.screen.games

import app.cash.turbine.test
import dev.convocados.data.api.ConvocadosApi
import dev.convocados.data.api.EventSummary
import dev.convocados.data.repository.EventRepository
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.*
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class GamesViewModelTest {
    private val repository = mockk<EventRepository>(relaxed = true)
    private val api = mockk<ConvocadosApi>(relaxed = true)
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
    fun `viewModel observes repository flows`() = runTest {
        val owned = listOf(EventSummary("1", "T1", "L1", "D1", "S1", 10, 5, null, false))
        val joined = listOf(EventSummary("2", "T2", "L2", "D2", "S2", 12, 6, null, false))
        
        coEvery { repository.getEventsByType("owned") } returns flowOf(owned)
        coEvery { repository.getEventsByType("joined") } returns flowOf(joined)
        coEvery { repository.getEventsByType("archivedOwned") } returns flowOf(emptyList())
        coEvery { repository.getEventsByType("archivedJoined") } returns flowOf(emptyList())

        val viewModel = GamesViewModel(repository, api)
        
        viewModel.ownedGames.test {
            assertEquals(owned, awaitItem())
        }
        viewModel.joinedGames.test {
            assertEquals(joined, awaitItem())
        }
    }

    @Test
    fun `refresh calls repository refresh`() = runTest {
        coEvery { repository.getEventsByType(any()) } returns flowOf(emptyList())
        val viewModel = GamesViewModel(repository, api)
        
        viewModel.refreshing.test {
            // The init block calls refresh(), so we might see true/false or just false depending on timing.
            // But since we are using StandardTestDispatcher, it won't run until we trigger it.
            
            // Initial state from StateFlow (it starts with false)
            assertEquals(false, awaitItem())
            
            viewModel.refresh()
            
            assertEquals(true, awaitItem())
            assertEquals(false, awaitItem())
        }

        coVerify { repository.refreshMyGames() }
    }
}
