package dev.convocados.ui.screen.history

import dev.convocados.data.api.*
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.*
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class EventHistoryViewModelTest {
    private val api = mockk<ConvocadosApi>()
    private val testDispatcher = StandardTestDispatcher()

    @Before
    fun setup() { Dispatchers.setMain(testDispatcher) }

    @After
    fun tearDown() { Dispatchers.resetMain() }

    @Test
    fun `load fetches paginated history`() = runTest {
        val games = listOf(
            GameHistory(id = "h1", dateTime = "2024-01-01T10:00:00Z", scoreOne = 3, scoreTwo = 2),
            GameHistory(id = "h2", dateTime = "2024-01-08T10:00:00Z", scoreOne = 1, scoreTwo = 1),
        )
        coEvery { api.fetchHistory("e1", null) } returns PaginatedHistory(data = games, hasMore = true, nextCursor = "c1")

        val vm = EventHistoryViewModel(api)
        vm.load("e1")
        advanceUntilIdle()

        assertEquals(2, vm.history.value.size)
        assertEquals(true, vm.hasMore.value)
        assertFalse(vm.loading.value)
    }

    @Test
    fun `loadMore appends next page`() = runTest {
        val page1 = listOf(GameHistory(id = "h1", dateTime = "2024-01-01T10:00:00Z"))
        val page2 = listOf(GameHistory(id = "h2", dateTime = "2024-01-08T10:00:00Z"))
        coEvery { api.fetchHistory("e1", null) } returns PaginatedHistory(data = page1, hasMore = true, nextCursor = "c1")
        coEvery { api.fetchHistory("e1", "c1") } returns PaginatedHistory(data = page2, hasMore = false)

        val vm = EventHistoryViewModel(api)
        vm.load("e1")
        advanceUntilIdle()

        vm.loadMore("e1")
        advanceUntilIdle()

        assertEquals(2, vm.history.value.size)
        assertEquals("h2", vm.history.value[1].id)
        assertFalse(vm.hasMore.value)
    }
}
