package dev.convocados.ui.screen.publicgames

import app.cash.turbine.test
import dev.convocados.data.api.ConvocadosApi
import dev.convocados.data.api.PaginatedPublicEvents
import dev.convocados.data.api.PublicEvent
import io.mockk.coEvery
import io.mockk.mockk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.*
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class PublicGamesViewModelTest {
    private val api = mockk<ConvocadosApi>()
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
    fun `initial load fetches events from api`() = runTest {
        val events = listOf(
            PublicEvent("1", "Title 1", "Loc 1", null, null, "Soccer", "2024-01-01T10:00:00Z", 10, 5, 5)
        )
        val response = PaginatedPublicEvents(data = events, nextCursor = "c1", hasMore = true)
        
        coEvery { api.fetchPublicEvents(null) } returns response

        val viewModel = PublicGamesViewModel(api)
        
        // Advance until idle to let the init { load() } finish
        advanceUntilIdle()

        assertEquals(events, viewModel.events.value)
        assertEquals(true, viewModel.hasMore.value)
        assertEquals(false, viewModel.loading.value)
    }

    @Test
    fun `loadMore appends events to current list`() = runTest {
        val initialEvents = listOf(PublicEvent("1", "T1", "L1", null, null, "S1", "D1", 10, 5, 5))
        val initialResponse = PaginatedPublicEvents(data = initialEvents, nextCursor = "c1", hasMore = true)
        
        val moreEvents = listOf(PublicEvent("2", "T2", "L2", null, null, "S2", "D2", 12, 6, 6))
        val moreResponse = PaginatedPublicEvents(data = moreEvents, nextCursor = "c2", hasMore = false)

        coEvery { api.fetchPublicEvents(null) } returns initialResponse
        coEvery { api.fetchPublicEvents("c1") } returns moreResponse

        val viewModel = PublicGamesViewModel(api)
        advanceUntilIdle()

        viewModel.loadMore()
        advanceUntilIdle()

        assertEquals(initialEvents + moreEvents, viewModel.events.value)
        assertEquals(false, viewModel.hasMore.value)
    }

    @Test
    fun `loading state is updated correctly`() = runTest {
        val response = PaginatedPublicEvents(data = emptyList(), nextCursor = null, hasMore = false)
        coEvery { api.fetchPublicEvents(any()) } returns response

        val viewModel = PublicGamesViewModel(api)

        viewModel.loading.test {
            // Initial state from init load() might be true or false depending on how fast it runs
            // But with StandardTestDispatcher it should be predictable
            assertEquals(true, awaitItem())
            assertEquals(false, awaitItem())
        }
    }
}
